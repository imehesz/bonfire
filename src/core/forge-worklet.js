// AudioWorklet DSP for Bonfire-only (non-Strudel) sounds. Loaded once by core/forge-audio.js.
// Runs in AudioWorkletGlobalScope: sampleRate / currentFrame / registerProcessor are globals.

// STRING: Karplus-Strong plucked string. A noise burst one period long circulates through a
// delay line with a lowpass in the loop, so every pass loses a little treble and level, which is
// exactly how a real string decays. That per-sample feedback is what Strudel's event engine can't do.
class BonfireString extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = options.processorOptions;
    this.startFrame = Math.round(o.start * sampleRate);
    this.endFrame = Math.round(o.end * sampleRate); // note off: switch to the release ring time
    this.stopFrame = Math.round(o.stop * sampleRate);
    // loop lowpass: y = (1 - a) x + a y1. BRIGHT 1 = almost no damping, 0 = dull thud
    this.a = (1 - o.bright) * 0.92;
    // the lowpass delays low frequencies by a / (1 - a) samples: take it off the loop to stay in tune
    const period = sampleRate / o.freq;
    this.delay = Math.max(2, period - this.a / (1 - this.a));
    this.size = Math.ceil(period) + 4;
    this.buf = new Float32Array(this.size);
    // per-pass gain for a T60 (seconds to fall 60 dB): freq passes per second
    const passGain = (t60) => 10 ** (-3 / (Math.max(0.02, t60) * o.freq));
    this.gHold = passGain(o.decay);
    this.gRel = passGain(o.release);
    // excitation: noise smoothed by PICK (0 = soft thumb, 1 = hard pick), DC removed
    const k = 0.05 + o.pick * 0.95;
    let lp = 0;
    let sum = 0;
    const n = Math.ceil(period);
    for (let i = 0; i < n; i++) {
      lp += k * (Math.random() * 2 - 1 - lp);
      this.buf[i] = lp;
      sum += lp;
    }
    const mean = sum / n;
    let peak = 1e-9;
    for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs((this.buf[i] -= mean)));
    for (let i = 0; i < n; i++) this.buf[i] *= 0.9 / peak;
    this.w = n; // write head; read head trails it by `delay`
    this.y1 = 0;
    this.port.onmessage = (e) => {
      if (e.data?.stop != null) this.stopFrame = Math.min(this.stopFrame, Math.round(e.data.stop * sampleRate));
    };
  }

  process(_inputs, outputs) {
    const out = outputs[0][0];
    if (!out) return true;
    const { buf, size, delay, a } = this;
    for (let i = 0; i < out.length; i++) {
      const f = currentFrame + i;
      if (f < this.startFrame || f >= this.stopFrame) {
        out[i] = 0;
        continue;
      }
      let r = this.w - delay;
      while (r < 0) r += size;
      const i0 = Math.floor(r);
      const fr = r - i0;
      const x = buf[i0 % size] * (1 - fr) + buf[(i0 + 1) % size] * fr;
      const y = (1 - a) * x + a * this.y1;
      this.y1 = y;
      buf[this.w] = y * (f < this.endFrame ? this.gHold : this.gRel);
      this.w = (this.w + 1) % size;
      out[i] = x;
    }
    for (let c = 1; c < outputs[0].length; c++) outputs[0][c].set(out);
    if (currentFrame + out.length >= this.stopFrame) {
      this.port.postMessage('done');
      return false;
    }
    return true;
  }
}

registerProcessor('bonfire-string', BonfireString);

// ---- shared bits for the oscillator voices (GROWL, FOLD) ----

// Linear attack / release amp envelope, sample-accurate against the note's start/end/stop times.
class Envelope {
  constructor(o) {
    this.start = Math.round(o.start * sampleRate);
    this.end = Math.round(o.end * sampleRate);
    this.stop = Math.round(o.stop * sampleRate);
    this.atk = Math.max(2, Math.round((o.attack ?? 0) * sampleRate)); // 2 frames min = no click
    this.rel = Math.max(Math.round(0.005 * sampleRate), Math.round((o.release ?? 0.1) * sampleRate));
    this.atEnd = Math.min(1, (this.end - this.start) / this.atk);
  }

  // amp at absolute frame f (0 before the note and after the release)
  at(f) {
    if (f < this.start || f >= this.stop) return 0;
    if (f < this.end) return Math.min(1, (f - this.start) / this.atk);
    return this.atEnd * Math.max(0, 1 - (f - this.end) / this.rel);
  }
}

// PolyBLEP: rounds off the saw/square jumps so high notes don't alias into hash.
function blep(t, dt) {
  if (t < dt) {
    t /= dt;
    return t + t - t * t - 1;
  }
  if (t > 1 - dt) {
    t = (t - 1) / dt;
    return t * t + t + t + 1;
  }
  return 0;
}

function finishBlock(proc, outputs, out) {
  for (let c = 1; c < outputs[0].length; c++) outputs[0][c].set(out);
  if (currentFrame + out.length >= proc.env.stop) {
    proc.port.postMessage('done');
    return false;
  }
  return true;
}

function listenForStop(proc) {
  proc.port.onmessage = (e) => {
    if (e.data?.stop != null) proc.env.stop = Math.min(proc.env.stop, Math.round(e.data.stop * sampleRate));
  };
}

// GROWL: filter FM. A saw / square through a resonant state-variable lowpass whose cutoff is swung
// at AUDIO rate by a sine running at RATIO x the note's pitch. Swing it by a few octaves and the
// filter itself starts adding sidebands: snarls, vowels, metal. Strudel's filters only take a new
// cutoff per note, so this can't be done there. FM depth can start high and decay (FM DEC).
class BonfireGrowl extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = options.processorOptions;
    this.env = new Envelope(o);
    this.freq = o.freq;
    this.square = o.wave === 1;
    this.cut = o.cutoff;
    this.k = 2 - 1.96 * Math.min(1, Math.max(0, o.res)); // SVF damping: 2 = no peak, ~0 = screaming
    this.fm = o.fm; // octaves of cutoff swing
    this.ratio = o.ratio;
    this.decFrames = o.fmdec > 0 ? o.fmdec * sampleRate : 0; // 0 = constant depth
    this.ph = 0;
    this.mph = 0;
    this.ic1 = 0;
    this.ic2 = 0;
    listenForStop(this);
  }

  process(_inputs, outputs) {
    const out = outputs[0][0];
    if (!out) return true;
    const { env, freq, k, cut } = this;
    const dt = freq / sampleRate;
    const mdt = (freq * this.ratio) / sampleRate;
    const nyq = sampleRate * 0.45;
    for (let i = 0; i < out.length; i++) {
      const f = currentFrame + i;
      const amp = env.at(f);
      if (amp === 0) {
        out[i] = 0;
        continue;
      }
      // oscillator
      const p = this.ph;
      let x;
      if (this.square) {
        x = (p < 0.5 ? 1 : -1) + blep(p, dt) - blep((p + 0.5) % 1, dt);
      } else {
        x = 2 * p - 1 - blep(p, dt);
      }
      this.ph = (p + dt) % 1;
      // audio-rate cutoff: base * 2^(depth * sine), depth optionally decaying from the note start
      const age = f - env.start;
      const depth = this.decFrames ? this.fm * Math.exp(-age / this.decFrames) : this.fm;
      const fc = Math.min(nyq, Math.max(20, cut * 2 ** (depth * Math.sin(2 * Math.PI * this.mph))));
      this.mph = (this.mph + mdt) % 1;
      // TPT state-variable filter (stable under fast modulation)
      const g = Math.tan((Math.PI * fc) / sampleRate);
      const a1 = 1 / (1 + g * (g + k));
      const v3 = x - this.ic2;
      const v1 = a1 * this.ic1 + g * a1 * v3;
      const v2 = this.ic2 + g * v1;
      this.ic1 = 2 * v1 - this.ic1;
      this.ic2 = 2 * v2 - this.ic2;
      out[i] = Math.tanh(v2 * 1.5) * amp * 0.6;
    }
    return finishBlock(this, outputs, out);
  }
}

registerProcessor('bonfire-growl', BonfireGrowl);

// FOLD: West-Coast wavefolder. A sine is driven past the rails and a triangle folder bounces it
// back, again and again: every fold adds harmonics, so FOLD goes from pure sine to glassy, buzzy,
// ringing tones. SYM offsets it (adds even harmonics). BLOOM adds extra fold at the note start that
// relaxes over TIME, like a lowpass gate opening and closing. 4x oversampled to keep aliasing down.
class BonfireFold extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = options.processorOptions;
    this.env = new Envelope(o);
    this.freq = o.freq;
    this.fold = o.fold;
    this.sym = o.sym;
    this.bloom = o.bloom;
    this.timeFrames = Math.max(1, o.time * sampleRate);
    this.ph = 0;
    this.lp = 0;
    listenForStop(this);
  }

  process(_inputs, outputs) {
    const out = outputs[0][0];
    if (!out) return true;
    const { env } = this;
    const OS = 4;
    const dt = this.freq / sampleRate / OS;
    // triangle folder: maps any value back into [-1, 1], one bounce per unit
    const tri = (v) => {
      const u = (v + 1) * 0.25;
      return 4 * Math.abs(u - Math.floor(u + 0.5)) - 1;
    };
    for (let i = 0; i < out.length; i++) {
      const f = currentFrame + i;
      const amp = env.at(f);
      if (amp === 0) {
        out[i] = 0;
        continue;
      }
      const drive = 1 + this.fold + this.bloom * Math.exp(-(f - env.start) / this.timeFrames);
      let acc = 0;
      for (let s = 0; s < OS; s++) {
        acc += tri(Math.sin(2 * Math.PI * this.ph) * drive + this.sym);
        this.ph = (this.ph + dt) % 1;
      }
      // boxcar decimation + a gentle one-pole to tame what's left up top
      this.lp += 0.7 * (acc / OS - this.lp);
      out[i] = this.lp * amp * 0.5;
    }
    return finishBlock(this, outputs, out);
  }
}

registerProcessor('bonfire-fold', BonfireFold);
