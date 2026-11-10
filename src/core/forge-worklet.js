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

// ACID: 303-style mono voice. One node plays a whole run of slid notes (see acidline() in
// modules/forge.js): `path` = [[when 0..1 across the note, midi, accent 0/1], ...]. The pitch glides
// to each new target (exponential, like the 303's RC slide) and nothing restarts on a slide, which is
// the sound. Saw / square (PolyBLEP) -> 4-pole TPT ladder lowpass with resonance feedback and a soft
// clip. The filter envelope fires at the note start and falls over DECAY; accents add a separate fast
// envelope that both opens the filter further and lifts the level, and it re-fires on accented
// slid-to notes too.
class BonfireAcid extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = options.processorOptions;
    this.env = new Envelope({ ...o, attack: Math.max(0.002, o.attack ?? 0) });
    const len = Math.max(1, this.env.end - this.env.start);
    const fallback = 69 + 12 * Math.log2(o.freq / 440);
    const path = o.path?.length ? o.path : [[0, fallback, 0]];
    this.segs = path.map(([w, m, a]) => ({ at: this.env.start + Math.round(w * len), midi: m, acc: a ? 1 : 0 }));
    this.seg = 0;
    this.cur = this.segs[0].midi;
    this.target = this.cur;
    this.glide = o.glide > 0 ? 1 - Math.exp(-3 / (o.glide * sampleRate)) : 1; // ~95% there after GLIDE
    this.square = o.wave === 1;
    this.cut = o.cutoff;
    this.k = 3.9 * Math.min(1, Math.max(0, o.res)); // ~4 = self-oscillation
    this.envmod = o.envmod;
    this.accent = o.accent;
    this.fenv = 1;
    this.fdec = Math.exp(-4.6 / (Math.max(0.01, o.decay) * sampleRate)); // falls to 1% over DECAY
    this.aenv = this.segs[0].acc;
    this.adec = Math.exp(-4.6 / (0.2 * sampleRate));
    this.ph = 0;
    this.s = [0, 0, 0, 0];
    listenForStop(this);
  }

  process(_inputs, outputs) {
    const out = outputs[0][0];
    if (!out) return true;
    const { env, segs, s } = this;
    const nyq = sampleRate * 0.45;
    const comp = 1 + this.k * 0.18; // win back some of the bass the resonance eats
    for (let i = 0; i < out.length; i++) {
      const f = currentFrame + i;
      const amp = env.at(f);
      if (amp === 0) {
        out[i] = 0;
        continue;
      }
      while (this.seg + 1 < segs.length && f >= segs[this.seg + 1].at) {
        const n = segs[++this.seg];
        this.target = n.midi;
        if (n.acc) this.aenv = 1;
      }
      this.cur += (this.target - this.cur) * this.glide;
      const freq = 440 * 2 ** ((this.cur - 69) / 12);
      const dt = freq / sampleRate;
      const p = this.ph;
      const x = this.square ? (p < 0.5 ? 1 : -1) + blep(p, dt) - blep((p + 0.5) % 1, dt) : 2 * p - 1 - blep(p, dt);
      this.ph = (p + dt) % 1;
      // cutoff: rest point + up to 4 octaves of envelope + up to 3 more on an accent
      const oct = this.envmod * 4 * this.fenv + this.accent * 3 * this.aenv;
      const fc = Math.min(nyq, Math.max(20, this.cut * 2 ** oct));
      this.fenv *= this.fdec;
      this.aenv *= this.adec;
      // 4-pole TPT ladder, feedback solved implicitly (stable under per-sample cutoff changes)
      const g = Math.tan((Math.PI * fc) / sampleRate);
      const G = g / (1 + g);
      const S = (G * G * G * s[0] + G * G * s[1] + G * s[2] + s[3]) / (1 + g);
      let u = (x * comp - this.k * S) / (1 + this.k * G * G * G * G);
      u = Math.tanh(u);
      let y = u;
      for (let st = 0; st < 4; st++) {
        const v = (y - s[st]) * G;
        y = v + s[st];
        s[st] = y + v;
      }
      const lift = 1 + this.accent * 0.7 * this.aenv; // after the clip, or the clip eats the accent
      out[i] = Math.tanh(y * 1.4) * amp * 0.5 * lift;
    }
    return finishBlock(this, outputs, out);
  }
}

registerProcessor('bonfire-acid', BonfireAcid);

// MODAL: modal synthesis. A struck object rings at a handful of natural frequencies ("modes"), each
// fading at its own rate. Every mode is a 2-pole resonator (a decaying sine) and they all get the
// same mallet hit: a raised-cosine pulse whose width is STRIKE (wide = soft felt, which also can't
// excite the high modes; narrow + a little noise = hard hammer). POS weights the modes like hitting a
// bar off-centre, DAMP makes high modes die faster, STRETCH bends the ratios. Ratios per MATERIAL:
// tuned marimba bar, wine glass, church bell (hum, prime, tierce, quint, nominal...), metal plate.
const MODAL_RATIOS = [
  [1, 3.93, 9.54, 16.69, 24.98, 34.9],
  [1, 2.32, 4.25, 6.63, 9.38, 12.5],
  [0.5, 1, 1.183, 1.506, 2, 2.514, 2.662, 3.011, 4.166, 5.433],
  [1, 1.59, 2.14, 2.3, 2.65, 2.92, 3.16, 3.5, 3.6, 4.06],
];
// relative loudness of each mode before POS / DAMP (bells: the hum and nominal are strong)
const MODAL_GAINS = [
  [1, 0.5, 0.25, 0.12, 0.08, 0.05],
  [1, 0.7, 0.45, 0.3, 0.2, 0.12],
  [0.7, 1, 0.8, 0.5, 0.9, 0.4, 0.35, 0.3, 0.25, 0.15],
  [1, 0.9, 0.8, 0.8, 0.7, 0.7, 0.6, 0.6, 0.5, 0.5],
];

class BonfireModal extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = options.processorOptions;
    this.env = new Envelope({ ...o, attack: 0, release: 0.01 }); // only for start/end/stop frames
    const m = Math.min(3, Math.max(0, o.material | 0));
    const nyq = sampleRate * 0.45;
    this.modes = [];
    let norm = 0;
    MODAL_RATIOS[m].forEach((r0, k) => {
      const r = r0 <= 1 ? r0 : 1 + (r0 - 1) * (1 + o.stretch); // stretch keeps the fundamental in place
      const hz = o.freq * r;
      if (hz > nyq || hz < 15) return;
      const w = (2 * Math.PI * hz) / sampleRate;
      // high modes die faster: T60 / ratio^(2 * DAMP)
      const t60 = Math.max(0.01, o.decay / Math.max(1, r) ** (2 * o.damp));
      const t60rel = Math.min(t60, o.release ?? 1);
      const rad = (t) => Math.exp(-6.9078 / (t * sampleRate));
      // strike position: like a bar hit at POS along its length (mode k has k+1 half-waves)
      const g = MODAL_GAINS[m][k] * (0.25 + Math.abs(Math.sin(Math.PI * (k + 1) * o.pos)));
      norm += g * g;
      this.modes.push({ c: 2 * Math.cos(w), sw: Math.sin(w), rHold: rad(t60), rRel: rad(t60rel), g, y1: 0, y2: 0 });
    });
    this.gain = 1 / Math.sqrt(Math.max(1e-6, norm));
    // mallet: raised cosine 40% (soft) .. 2% (hard) of the note's period, area 1, plus a little noise
    // when hard. Wider than ~half a period and the pulse would cancel the note's own fundamental.
    const width = Math.min(0.01, (0.4 - 0.38 * o.strike) / o.freq);
    const len = Math.max(2, Math.round(sampleRate * width));
    this.exc = new Float32Array(len);
    let sum = 0;
    for (let i = 0; i < len; i++) sum += (this.exc[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 0.5)) / len));
    for (let i = 0; i < len; i++) this.exc[i] = this.exc[i] / sum + (Math.random() * 2 - 1) * 0.15 * o.strike ** 2;
    listenForStop(this);
  }

  process(_inputs, outputs) {
    const out = outputs[0][0];
    if (!out) return true;
    const { env, modes, exc } = this;
    for (let i = 0; i < out.length; i++) {
      const f = currentFrame + i;
      if (f < env.start || f >= env.stop) {
        out[i] = 0;
        continue;
      }
      const age = f - env.start;
      const x = age < exc.length ? exc[age] : 0;
      const held = f < env.end;
      let y = 0;
      for (const md of modes) {
        const r = held ? md.rHold : md.rRel;
        const v = md.c * r * md.y1 - r * r * md.y2 + x * md.sw;
        md.y2 = md.y1;
        md.y1 = v;
        y += v * md.g;
      }
      // short fade at the very end so a cut-off ring doesn't click
      const tail = env.stop - f;
      const fade = tail < 256 ? tail / 256 : 1;
      out[i] = Math.tanh(y * this.gain * 1.2) * fade;
    }
    return finishBlock(this, outputs, out);
  }
}

registerProcessor('bonfire-modal', BonfireModal);

// HOOVER: supersaw. Seven PolyBLEP saws at JP-8000-style detune offsets, random start phases (so no
// two notes sound alike), the centre saw against the six outer ones by MIX (the JP curves), spread
// across a STEREO output by WIDTH. HOOVER mode turns each saw into saw + a pulse whose width drifts
// on its own slow LFO (the Alpha Juno "hoover" wooze). DIP: the note starts DIP semitones flat and
// swoops up over TIME. SUB: one plain saw an octave down, centred.
const SUPER_OFFSETS = [-0.11002313, -0.06288439, -0.01952356, 0, 0.01991221, 0.06216538, 0.10745242];
const SUPER_PANS = [-1, 0.67, -0.33, 0, 0.33, -0.67, 1];

class BonfireHoover extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = options.processorOptions;
    this.env = new Envelope(o);
    this.freq = o.freq;
    this.hoover = o.mode === 1;
    const d = Math.min(1, Math.max(0, o.detune));
    const amt = d * d * 0.6 + d * 0.4; // gentle at the bottom, wide at the top
    const m = Math.min(1, Math.max(0, o.mix));
    const side = -0.73764 * m * m + 1.2841 * m + 0.044372;
    const centre = -0.55366 * m + 0.99785;
    const w = Math.min(1, Math.max(0, o.width));
    this.oscs = SUPER_OFFSETS.map((off, i) => {
      const g = (i === 3 ? centre : side) / 2.6;
      const pan = SUPER_PANS[i] * w; // equal-power
      const a = ((pan + 1) * Math.PI) / 4;
      return {
        ratio: 1 + off * amt,
        ph: Math.random(),
        gl: g * Math.cos(a),
        gr: g * Math.sin(a),
        lph: Math.random(),
        lrate: (0.35 + Math.random() * 0.9) / sampleRate, // HOOVER pulse-width drift, ~0.35-1.25 Hz
      };
    });
    this.sub = Math.min(1, Math.max(0, o.sub)) * 0.35;
    this.subPh = Math.random();
    this.dip = Math.max(0, o.dip ?? 0);
    this.dipFrames = Math.max(1, (o.diptime ?? 0.15) * sampleRate / 3); // ~95% there after TIME
    // DC blocker per side (the pulse mix and detune beats can wander)
    this.dcL = { x: 0, y: 0 };
    this.dcR = { x: 0, y: 0 };
    listenForStop(this);
  }

  process(_inputs, outputs) {
    const L = outputs[0][0];
    const R = outputs[0][1] ?? L;
    if (!L) return true;
    const { env, oscs } = this;
    const saw = (p, dt) => 2 * p - 1 - blep(p, dt);
    for (let i = 0; i < L.length; i++) {
      const f = currentFrame + i;
      const amp = env.at(f);
      if (amp === 0) {
        L[i] = 0;
        R[i] = 0;
        continue;
      }
      const bend = this.dip ? 2 ** ((-this.dip * Math.exp(-(f - env.start) / this.dipFrames)) / 12) : 1;
      const base = (this.freq * bend) / sampleRate;
      let l = 0;
      let r = 0;
      for (const o of oscs) {
        const dt = base * o.ratio;
        let x = saw(o.ph, dt);
        if (this.hoover) {
          const pw = 0.5 + 0.4 * Math.sin(2 * Math.PI * o.lph);
          x = 0.55 * x + 0.45 * (x - saw((o.ph + pw) % 1, dt));
          o.lph = (o.lph + o.lrate) % 1;
        }
        o.ph = (o.ph + dt) % 1;
        l += x * o.gl;
        r += x * o.gr;
      }
      if (this.sub) {
        const dt = base * 0.5;
        const x = saw(this.subPh, dt) * this.sub;
        this.subPh = (this.subPh + dt) % 1;
        l += x;
        r += x;
      }
      // one-pole DC block (~10 Hz), then soft clip
      const k = 0.9986;
      this.dcL.y = l - this.dcL.x + k * this.dcL.y;
      this.dcL.x = l;
      this.dcR.y = r - this.dcR.x + k * this.dcR.y;
      this.dcR.x = r;
      L[i] = Math.tanh(this.dcL.y * 1.2) * amp;
      R[i] = Math.tanh(this.dcR.y * 1.2) * amp;
    }
    if (currentFrame + L.length >= env.stop) {
      this.port.postMessage('done');
      return false;
    }
    return true;
  }
}

registerProcessor('bonfire-hoover', BonfireHoover);

// ---- shared: TPT state-variable filter (lowpass / bandpass / highpass out of one update) ----
class Svf {
  constructor(cutoff, q = 0.7) {
    this.s1 = 0;
    this.s2 = 0;
    this.set(cutoff, q);
  }

  set(cutoff, q) {
    const g = Math.tan((Math.PI * Math.min(cutoff, sampleRate * 0.45)) / sampleRate);
    this.k = 1 / q;
    this.a1 = 1 / (1 + g * (g + this.k));
    this.g = g;
  }

  // returns this; read .lp / .bp / .hp
  run(x) {
    const v1 = this.a1 * (this.s1 + this.g * (x - this.s2));
    const v2 = this.s2 + this.g * v1;
    this.s1 = 2 * v1 - this.s1;
    this.s2 = 2 * v2 - this.s2;
    this.lp = v2;
    this.bp = v1;
    this.hp = x - this.k * v1 - v2;
    return this;
  }
}

// DRUM: analog-style drum synthesis (808 / 909 family). One-shot: it ignores the note length.
// KICK / TOM / SNARE = a sine body whose pitch starts PUNCH octaves high and falls to the note,
// plus filtered noise; CLAP = three fast noise bursts and a tail through a bandpass; HAT = six
// detuned square waves at the 808's metallic ratios plus noise, through a highpass.
const HAT_RATIOS = [205.3, 304.4, 369.6, 522.7, 540, 800];
const DRUM_PUNCH = [4, 2, 1.2, 0, 0]; // octaves of pitch drop at PUNCH 1
const DRUM_DROP = [0.03, 0.045, 0.02, 0, 0]; // pitch-drop time constant, s
const DRUM_NOISE = [0, 0.04, 0.55, 1, 0.35]; // noise already there at NOISE 0

class BonfireDrum extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = options.processorOptions;
    this.env = { start: Math.round(o.start * sampleRate), stop: Math.round(o.stop * sampleRate) };
    const m = (this.model = o.model);
    this.freq = o.freq;
    this.punch = Math.min(1, Math.max(0, o.punch));
    this.tone = Math.min(1, Math.max(0, o.tone));
    this.click = Math.min(1, Math.max(0, o.click)) * (m === 4 ? 0.4 : 1);
    this.drive = Math.min(1, Math.max(0, o.drive));
    const n = Math.min(1, Math.max(0, o.noise));
    this.noiseAmt = DRUM_NOISE[m] + (1 - DRUM_NOISE[m]) * n * (m === 0 ? 0.35 : 1);
    // per-sample decay multipliers for a T60 of `s` seconds
    const k = (s) => Math.exp(-6.91 / (Math.max(0.005, s) * sampleRate));
    const d = o.decay;
    this.kBody = k(m === 2 ? d * 0.55 : d);
    this.kNoise = k(m === 0 ? Math.min(0.08, d * 0.3) : m === 1 ? d * 0.25 : d);
    this.kClick = k(0.004);
    this.kDrop = Math.exp(-1 / (DRUM_DROP[m] * (1.3 - this.punch * 0.6) * sampleRate || 1));
    this.drop = DRUM_PUNCH[m] * this.punch;
    this.body = m <= 2 ? 1 : 0;
    this.nAmp = 1;
    this.cAmp = 1;
    this.ph = 0;
    this.ph2 = 0;
    // CLAP: bursts SP apart (PUNCH 1 = tight, 0 = loose), then the tail
    this.sp = Math.round((0.006 + (1 - this.punch) * 0.012) * sampleRate);
    this.kBurst = k(0.03);
    // noise colour
    if (m === 0 || m === 1) this.nf = new Svf(300 + this.tone * 4000, 0.7);
    else if (m === 2) this.nf = new Svf(900 + this.tone * 5000, 0.8);
    else if (m === 3) this.nf = new Svf((700 + this.tone * 1900) * o.freq, 1.6);
    else this.nf = new Svf((5000 + this.tone * 5000) * (0.85 + 0.3 * (o.freq - 1)), 0.9);
    if (m === 4) {
      this.metal = HAT_RATIOS.map((r) => ({ dt: (r * 1.5 * (0.85 + 0.3 * (o.freq - 1))) / sampleRate, ph: Math.random() }));
      this.mf = new Svf(9000 + this.tone * 3000, 1.2);
      this.mh = new Svf(6500, 0.7);
    }
    this.dc = { x: 0, y: 0 };
    this.port.onmessage = (e) => {
      if (e.data?.stop != null) this.env.stop = Math.min(this.env.stop, Math.round(e.data.stop * sampleRate));
    };
  }

  process(_inputs, outputs) {
    const out = outputs[0][0];
    if (!out) return true;
    const m = this.model;
    const drv = 1 + this.drive * 5;
    const norm = 1 / Math.tanh(drv);
    for (let i = 0; i < out.length; i++) {
      const f = currentFrame + i;
      if (f < this.env.start || f >= this.env.stop) {
        out[i] = 0;
        continue;
      }
      const n = f - this.env.start;
      let x = 0;
      if (this.body) {
        // pitch sweep: PUNCH octaves above the note, falling exponentially
        const fr = this.freq * 2 ** (this.drop * this.kDrop ** n);
        this.ph = (this.ph + fr / sampleRate) % 1;
        let b = Math.sin(2 * Math.PI * this.ph);
        if (m === 2) {
          // snare: second membrane mode
          this.ph2 = (this.ph2 + (fr * 1.6) / sampleRate) % 1;
          b = 0.6 * b + 0.4 * Math.sin(2 * Math.PI * this.ph2);
        }
        // TONE rounds the sine off into a harder, rounder-square body
        const sh = 1 + this.tone * this.tone * 5;
        b = Math.tanh(b * sh) / Math.tanh(sh);
        x += b * this.body * (m === 2 ? 0.7 : 1);
        this.body *= this.kBody;
      }
      if (this.noiseAmt) {
        let env = this.nAmp;
        if (m === 3) {
          // three fast claps then the room tail
          const sp = this.sp;
          env = n < 3 * sp ? this.kBurst ** (n % sp) * (1 - 0.15 * Math.floor(n / sp)) : 0.75 * this.nAmp;
          if (n >= 3 * sp) this.nAmp *= this.kNoise;
        } else {
          this.nAmp *= this.kNoise;
        }
        const r = this.nf.run(Math.random() * 2 - 1);
        const v = m <= 1 ? r.lp : m === 3 ? r.bp * 2.2 : r.hp;
        x += v * env * this.noiseAmt * (m === 2 ? 0.8 : 1);
      }
      if (this.metal) {
        let s = 0;
        for (const o of this.metal) {
          o.ph = (o.ph + o.dt) % 1;
          s += o.ph < 0.5 ? 1 : -1;
        }
        const mv = this.mh.run(this.mf.run(s / 6).bp).hp;
        // PUNCH: a sharper hit in the first few ms
        const hit = 1 + this.punch * 2 * Math.exp(-n / (0.004 * sampleRate));
        x += mv * 2.5 * this.nAmp * hit * (1 - 0.5 * this.noiseAmt);
      }
      if (this.click && n < 0.01 * sampleRate) {
        x += (Math.random() * 2 - 1) * 0.6 * this.cAmp * this.click + (n < 2 ? this.click * 0.5 : 0);
        this.cAmp *= this.kClick;
      }
      // DC block, then DRIVE (level-compensated tanh)
      this.dc.y = x - this.dc.x + 0.9995 * this.dc.y;
      this.dc.x = x;
      out[i] = Math.tanh(this.dc.y * drv) * norm * (1 / (1 + this.drive * 0.8));
    }
    for (let c = 1; c < outputs[0].length; c++) outputs[0][c].set(out);
    if (currentFrame + out.length >= this.env.stop) {
      this.port.postMessage('done');
      return false;
    }
    return true;
  }
}

registerProcessor('bonfire-drum', BonfireDrum);

// GRAIN: granular cloud. Many short, overlapping, smoothly faded slices ("grains") of a sample,
// each read from around POS (+/- SPRAY), so a single sound smears into pads, shimmer and texture.
// The sample's audio is sent once per sample and kept here, shared by every GRAIN note.
const GRAIN_BUFS = new Map(); // id -> { data, rate }
const HANN = new Float32Array(1025).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / 1024));
const MAX_GRAINS = 64;

class BonfireGrain extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = options.processorOptions;
    if (o.data) GRAIN_BUFS.set(o.buf, { data: o.data, rate: o.bufRate });
    this.src = GRAIN_BUFS.get(o.buf);
    this.env = new Envelope(o);
    const c = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    this.rate = o.rate * ((this.src?.rate ?? sampleRate) / sampleRate); // source frames per output frame
    this.pos = c(o.pos, 0, 1);
    this.spray = c(o.spray, 0, 1);
    this.scan = c(o.scan, -2, 2);
    this.size = Math.max(32, Math.round(c(o.size, 0.005, 2) * sampleRate));
    this.density = c(o.density, 0.5, 200);
    this.shimmer = c(o.shimmer, 0, 1);
    this.width = c(o.width, 0, 1);
    this.gain = 1 / Math.sqrt(Math.max(1, this.density * (this.size / sampleRate)));
    this.grains = [];
    this.next = this.env.start;
    listenForStop(this);
  }

  spawn(f) {
    const len = this.src.data.length;
    const t = (f - this.env.start) / sampleRate;
    // SCAN 1 = the read point moves through the sample at normal speed, 0 = frozen
    let p = this.pos * len + this.scan * t * this.src.rate + (Math.random() * 2 - 1) * this.spray * 0.25 * len;
    p = ((p % len) + len) % len;
    let st = (Math.random() * 2 - 1) * this.shimmer * 0.3;
    if (Math.random() < this.shimmer * 0.35) st += 12; // SHIMMER: some grains an octave up
    const pan = (Math.random() * 2 - 1) * this.width;
    const a = ((pan + 1) * Math.PI) / 4;
    this.grains.push({ p, r: this.rate * 2 ** (st / 12), n: 0, gl: Math.cos(a), gr: Math.sin(a) });
  }

  process(_inputs, outputs) {
    const L = outputs[0][0];
    const R = outputs[0][1] ?? L;
    if (!L) return true;
    const { env, src } = this;
    if (!src) {
      L.fill(0);
      R.fill(0);
      this.port.postMessage('done');
      return false;
    }
    const data = src.data;
    const len = data.length;
    const step = sampleRate / this.density;
    const ws = 1024 / this.size;
    for (let i = 0; i < L.length; i++) {
      const f = currentFrame + i;
      const amp = env.at(f);
      if (f >= this.next && f < env.stop) {
        if (this.grains.length < MAX_GRAINS) this.spawn(f);
        this.next += step * (0.7 + Math.random() * 0.6); // a little irregular = no buzz at the grain rate
      }
      let l = 0;
      let r = 0;
      for (let g = this.grains.length - 1; g >= 0; g--) {
        const gr = this.grains[g];
        const i0 = Math.floor(gr.p);
        const fr = gr.p - i0;
        const s = data[i0 % len] * (1 - fr) + data[(i0 + 1) % len] * fr;
        const w = HANN[Math.min(1024, Math.round(gr.n * ws))];
        l += s * w * gr.gl;
        r += s * w * gr.gr;
        gr.p += gr.r;
        if (gr.p >= len) gr.p -= len;
        if (++gr.n >= this.size) this.grains.splice(g, 1);
      }
      L[i] = l * this.gain * amp;
      R[i] = r * this.gain * amp;
    }
    if (currentFrame + L.length >= env.stop) {
      this.port.postMessage('done');
      return false;
    }
    return true;
  }
}

registerProcessor('bonfire-grain', BonfireGrain);

// FM4: four sine operators doing phase modulation (the DX7 way). ALGO = who modulates whom;
// operators feeding a carrier bend its phase by up to MOD_DEPTH radians at LEVEL 1. Runs at 2x
// the sample rate so bright settings and feedback don't alias. Same wiring as FM_ALGOS in
// modules/forge.js (kept in sync by hand): mods[i] = operators feeding i, car = the ones you hear.
const FM_WIRING = [
  { mods: [[1], [2], [3], []], car: [0] },
  { mods: [[1], [], [3], []], car: [0, 2] },
  { mods: [[1, 2, 3], [], [], []], car: [0] },
  { mods: [[2], [2], [3], []], car: [0, 1] },
  { mods: [[], [2], [3], []], car: [0, 1] },
  { mods: [[3], [3], [3], []], car: [0, 1, 2] },
  { mods: [[1], [], [], []], car: [0, 2, 3] },
  { mods: [[], [], [], []], car: [0, 1, 2, 3] },
];
const MOD_DEPTH = 7;
// sine of x CYCLES from a 4096-point table (linear interpolation): far cheaper than Math.sin and
// FM4 needs ~8 per output sample per voice
const SIN_N = 4096;
const SIN_T = new Float32Array(SIN_N + 1).map((_, i) => Math.sin((2 * Math.PI * i) / SIN_N));
const INV_TAU = 1 / (2 * Math.PI);
function fmSin(x) {
  x -= Math.floor(x);
  const p = x * SIN_N;
  const i = p | 0;
  return SIN_T[i] + (SIN_T[i + 1] - SIN_T[i]) * (p - i);
}
const METAL_SPREAD = [0, 0.137, 0.291, 0.413]; // METAL nudges each modulator's ratio by a different amount

class BonfireFm extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = options.processorOptions;
    const c = (v, lo, hi) => Math.min(hi, Math.max(lo, Number(v) || 0));
    this.start = Math.round(o.start * sampleRate);
    this.end = Math.round(o.end * sampleRate);
    this.stopFrame = Math.round(o.stop * sampleRate);
    const w = FM_WIRING[Math.round(c(o.algo, 0, 7))];
    this.mods = w.mods;
    const isCar = [0, 1, 2, 3].map((i) => w.car.includes(i));
    this.carGain = 1 / Math.sqrt(w.car.length);
    // BASIC macros on top of the operator settings
    const bright = 2 ** ((c(o.bright, 0, 1) - 0.5) * 3) * (o.acc ? 1.6 : 1);
    const time = 4 ** ((c(o.time, 0, 1) - 0.5) * 2);
    const metal = c(o.metal, 0, 1);
    const soften = c(o.soften, 0, 1) * 1.5;
    this.accLift = o.acc ? 1.15 : 1;
    this.hold = !!o.hold;
    this.sus = c(o.sus, 0, 1);
    const sr2 = sampleRate * 2;
    const relK = Math.exp(-6.91 / (Math.max(0.01, o.release ?? 0.4) * sr2));
    this.ops = o.ops.map(([ratio, level, atk, dec], i) => {
      const r = c(ratio, 0.1, 32) * (isCar[i] ? 1 : 1 + metal * METAL_SPREAD[i] * 2);
      const a = c(atk, 0, 6) + (isCar[i] ? soften : soften * 0.5);
      return {
        dt: (o.freq * r) / sr2,
        ph: 0,
        // a carrier's LEVEL = loudness, a modulator's = how hard it bends (BRIGHT scales only these)
        level: c(level, 0, 1) * (isCar[i] ? 1 : bright * MOD_DEPTH),
        car: isCar[i],
        atkN: Math.max(2, Math.round(a * sr2)),
        decK: Math.exp(-6.91 / (Math.max(0.01, c(dec, 0.01, 30) * time) * sr2)),
        relK,
        env: 0,
        decaying: 1, // level above the sustain floor, decays toward 0
        rel: -1, // level the release falls from (-1 = note still held)
        out: 0,
      };
    });
    this.fb = c(o.fb, 0, 1) * 2.2;
    this.fb1 = 0;
    this.fb2 = 0;
    this.silentFor = 0; // 2x-rate samples in a row with every carrier faded out
    // CHORUS: two short delay lines swung by slow LFOs, one per side
    this.chorus = !!o.chorus;
    if (this.chorus) {
      this.dl = new Float32Array(2048);
      this.dw = 0;
      this.lfo = Math.random();
    }
    this.port.onmessage = (e) => {
      if (e.data?.stop != null) this.stopFrame = Math.min(this.stopFrame, Math.round(e.data.stop * sampleRate));
    };
  }

  // one 2x-rate sample; n2 = frames since note start at the 2x rate, held = note still down
  // one 2x-rate sample; n2 = frames since note start at the 2x rate, held = note still down.
  // Hot loop: table sine, phases in cycles (modulation converted from radians once).
  tick(n2, held) {
    const { ops, mods } = this;
    let alive = false;
    for (let i = 3; i >= 0; i--) {
      const op = ops[i];
      // envelope: linear attack, then exponential decay (to SUS while held with HOLD); after the
      // note ends it releases from wherever it was (a struck note also keeps its own decay)
      let target;
      if (n2 < op.atkN) target = n2 / op.atkN;
      else {
        op.decaying *= op.decK;
        target = held && this.hold ? this.sus + (1 - this.sus) * op.decaying : op.decaying;
      }
      if (held) op.env = target;
      else {
        if (op.rel < 0) op.rel = op.env;
        op.rel *= op.relK;
        op.env = this.hold ? op.rel : Math.min(op.rel, target);
      }
      op.ph += op.dt;
      if (op.ph >= 1) op.ph -= 1;
      const amp = op.env * op.level;
      if (amp < 1e-6 && i !== 3) {
        op.out = 0; // silent operator: skip its sine
        continue;
      }
      if (op.car && op.env > 1e-4) alive = true;
      let pm = 0;
      const mi = mods[i];
      for (let k = 0; k < mi.length; k++) pm += ops[mi[k]].out;
      if (i === 3 && this.fb) pm += this.fb * (this.fb1 + this.fb2) * 0.5;
      const x = fmSin(op.ph + pm * INV_TAU);
      op.out = x * amp;
      if (i === 3) {
        this.fb2 = this.fb1;
        this.fb1 = x;
      }
    }
    if (n2 > 64 && !alive) this.silentFor++;
    else this.silentFor = 0;
    let y = 0;
    for (let i = 0; i < 4; i++) if (ops[i].car) y += ops[i].out;
    return y * this.carGain;
  }

  process(_inputs, outputs) {
    const L = outputs[0][0];
    const R = outputs[0][1] ?? L;
    if (!L) return true;
    for (let i = 0; i < L.length; i++) {
      const f = currentFrame + i;
      if (f < this.start || f >= this.stopFrame) {
        L[i] = 0;
        R[i] = 0;
        continue;
      }
      const n2 = (f - this.start) * 2;
      const held = f < this.end;
      const x = (this.tick(n2, held) + this.tick(n2 + 1, held)) * 0.5 * this.accLift;
      // 5 ms fade at the very end so a cut-off tail never clicks
      const tail = Math.min(1, (this.stopFrame - f) / (0.005 * sampleRate));
      if (!this.chorus) {
        L[i] = x * tail;
        R[i] = L[i];
        continue;
      }
      const { dl } = this;
      dl[this.dw] = x;
      this.lfo = (this.lfo + 0.6 / sampleRate) % 1;
      const tap = (phase) => {
        const d = (0.007 + 0.0025 * Math.sin(2 * Math.PI * (this.lfo + phase))) * sampleRate;
        let r = this.dw - d;
        if (r < 0) r += 2048;
        const i0 = Math.floor(r);
        const fr = r - i0;
        return dl[i0 & 2047] * (1 - fr) + dl[(i0 + 1) & 2047] * fr;
      };
      L[i] = (x * 0.75 + tap(0) * 0.55) * tail;
      R[i] = (x * 0.75 + tap(0.5) * 0.55) * tail;
      this.dw = (this.dw + 1) & 2047;
    }
    // a struck note that has died away (every carrier under -80 dB for 20 ms): free the voice now
    // instead of running silent until its scheduled stop
    if (this.silentFor > sampleRate * 0.04) this.stopFrame = Math.min(this.stopFrame, currentFrame + L.length);
    if (currentFrame + L.length >= this.stopFrame) {
      this.port.postMessage('done');
      return false;
    }
    return true;
  }
}

registerProcessor('bonfire-fm', BonfireFm);

// TAPE: one continuous stereo tape loop per TAPE module (not per note). Input = the module's send
// bus (every note fed into TAPE, after its gain / pan). Three playback heads at TIME, 2x and 3x;
// HEADS is a bitmask. What the active heads play is fed back (REPEATS) through the "tape": a
// lowpass at TONE (AGE darkens it and adds a low cut), then SAT. TIME changes glide like a tape
// changing speed; WOW wobbles the read point (slow wow + fast flutter). Output = echoes only.
const TAPE_SECONDS = 20; // 1 BAR at 40 BPM x head 3 = 18 s
class BonfireTapeBus extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = Math.ceil(sampleRate * TAPE_SECONDS);
    this.buf = [new Float32Array(this.size), new Float32Array(this.size)];
    this.w = 0;
    this.p = { time: 0.375, heads: 1, fb: 0.5, echo: 0.6, tone: 3200, age: 0.4, sat: 0.25, wow: 0.3 };
    this.t = -1; // current (gliding) head-1 delay in frames
    this.lfo1 = 0;
    this.lfo2 = 0;
    this.lp = [0, 0];
    this.hp = [0, 0];
    this.echoNow = 0;
    this.coef();
    this.port.onmessage = (e) => {
      Object.assign(this.p, e.data);
      this.coef();
    };
  }

  coef() {
    const { tone, age } = this.p;
    const cut = Math.max(200, tone * (1 - age * 0.5));
    this.aLp = Math.exp((-2 * Math.PI * cut) / sampleRate);
    this.aHp = Math.exp((-2 * Math.PI * (40 + age * 220)) / sampleRate);
    this.satG = 1 + this.p.sat * 3;
    this.heads = [1, 2, 3].filter((k) => this.p.heads & (1 << (k - 1)));
    this.headNorm = 1 / Math.sqrt(this.heads.length || 1);
  }

  read(ch, d) {
    let r = this.w - d;
    while (r < 0) r += this.size;
    const i0 = r | 0;
    const fr = r - i0;
    const b = this.buf[ch];
    return b[i0] + (b[i0 + 1 === this.size ? 0 : i0 + 1] - b[i0]) * fr;
  }

  process(inputs, outputs) {
    const inp = inputs[0];
    const out = outputs[0];
    const L = out[0];
    const R = out[1] ?? L;
    const inL = inp?.[0];
    const inR = inp?.[1] ?? inL;
    const { p, heads, headNorm } = this;
    const target = Math.min(this.size / 3 - 4, Math.max(16, p.time * sampleRate));
    if (this.t < 0) this.t = target;
    const glide = 1 - Math.exp(-1 / (0.12 * sampleRate)); // ~0.12 s tape-speed change
    const fb = Math.min(0.97, Math.max(0, p.fb));
    const wow = p.wow;
    for (let i = 0; i < L.length; i++) {
      this.t += (target - this.t) * glide;
      this.lfo1 += 0.55 / sampleRate;
      this.lfo2 += 6.3 / sampleRate;
      if (this.lfo1 >= 1) this.lfo1 -= 1;
      if (this.lfo2 >= 1) this.lfo2 -= 1;
      const mod = 1 + wow * (0.0035 * Math.sin(2 * Math.PI * this.lfo1) + 0.0008 * Math.sin(2 * Math.PI * this.lfo2));
      const d = this.t * mod;
      this.echoNow += (p.echo - this.echoNow) * 0.001; // no zipper when ECHO is turned
      for (let ch = 0; ch < 2; ch++) {
        let wet = 0;
        for (let k = 0; k < heads.length; k++) wet += this.read(ch, d * heads[k]);
        wet *= headNorm;
        const x = (ch === 0 ? inL?.[i] : inR?.[i]) ?? 0;
        // the tape: lowpass, low cut, saturation, then onto the loop
        let y = x + fb * wet;
        this.lp[ch] = y + (this.lp[ch] - y) * this.aLp;
        y = this.lp[ch];
        this.hp[ch] = y + (this.hp[ch] - y) * this.aHp;
        y -= this.hp[ch];
        if (this.p.sat > 0.005) y = (Math.tanh(y * this.satG) / this.satG) * (1 + this.p.sat * 0.6);
        this.buf[ch][this.w] = y;
        (ch === 0 ? L : R)[i] = wet * this.echoNow;
      }
      this.w = this.w + 1 === this.size ? 0 : this.w + 1;
    }
    return true;
  }
}

registerProcessor('bonfire-tapebus', BonfireTapeBus);

// FRIDGE: a freeze pedal. One per FRIDGE module, fed by the module's send bus (every note going
// through it). { freeze: seconds, at?: time } records that much of the input (plus a short overlap)
// and then plays it for as long as it is held; { release: true } fades it out. There are two
// slots, so a new freeze is recorded while the old one keeps playing and they swap with a fade.
// LOOP plays the slice round and round (the overlap is crossfaded over the start of each pass, so
// the loop point doesn't click). SMOOTH plays it as overlapping grains taken from random spots in
// the slice, so there is no audible repeat. Each new grain is slid (up to 20 ms) to where it lines
// up best with what the previous grain was about to play, so the waves stay in step and a held
// note or chord comes out as a steady pad instead of warbling. Output = the frozen sound only.
const FRIDGE_MAX = 1; // seconds, the LENGTH knob's top
const FRIDGE_XFADE = 0.03;
const FRIDGE_GRAIN = 0.1; // seconds; two grains, half overlapped (their Hann windows add up to 1)
const FRIDGE_SEARCH = 0.02; // how far a grain may slide to line up
const FRIDGE_MATCH = 256; // samples compared (every 2nd one)
class BonfireFridge extends AudioWorkletProcessor {
  constructor() {
    super();
    const cap = Math.ceil(sampleRate * (FRIDGE_MAX + FRIDGE_XFADE)) + 8;
    const slot = () => ({ buf: [new Float32Array(cap), new Float32Array(cap)], mono: new Float32Array(cap), n: 0, x: 0, r: 0, on: 0, gain: 0, grains: [], size: 128, next: 0 });
    this.slots = [slot(), slot()];
    this.cur = 0; // the slot that is (or was last) playing
    this.rec = -1; // the slot being recorded, -1 = none
    this.w = 0;
    this.pend = null; // a freeze waiting for its start time: { at: frame, len }
    this.smooth = 0;
    this.level = 1;
    this.levelNow = 1;
    this.port.onmessage = (e) => {
      const d = e.data;
      if (d.level != null) this.level = d.level;
      if (d.smooth != null) this.smooth = d.smooth ? 1 : 0;
      if (d.freeze != null) this.pend = { at: d.at != null ? Math.round(d.at * sampleRate) : 0, len: d.freeze };
      if (d.release) {
        this.pend = null;
        this.rec = -1;
        this.slots[this.cur].on = 0;
      }
    };
  }

  startRec(len) {
    const c = this.slots[this.cur];
    this.rec = c.on || c.gain > 1e-4 ? 1 - this.cur : this.cur;
    const s = this.slots[this.rec];
    s.n = Math.round(Math.min(FRIDGE_MAX, Math.max(0.02, len)) * sampleRate);
    s.x = Math.min(Math.round(FRIDGE_XFADE * sampleRate), s.n >> 2);
    s.on = 0;
    s.gain = 0;
    this.w = 0;
  }

  // Start a grain at a random spot; with `after` (the grain playing now) slide it to the best match
  // for what that grain plays next.
  newGrain(s, g, after) {
    const total = s.n + s.x;
    const range = Math.max(1, Math.min(Math.round(FRIDGE_SEARCH * sampleRate), total - s.size - 1));
    const base = Math.floor(Math.random() * Math.max(1, total - s.size - range));
    let best = 0;
    if (after) {
      const m = s.mono;
      const want = after.start + after.i;
      const len = Math.min(FRIDGE_MATCH, s.size >> 1);
      let top = -Infinity;
      for (let d = 0; d < range; d++) {
        let dot = 0;
        let energy = 1e-9;
        for (let j = 0; j < len; j += 2) {
          const y = m[base + d + j];
          dot += y * m[want + j];
          energy += y * y;
        }
        const score = dot / Math.sqrt(energy);
        if (score > top) {
          top = score;
          best = d;
        }
      }
    }
    g.start = base + best;
    g.i = 0;
  }

  endRec() {
    const s = this.slots[this.rec];
    if (this.rec !== this.cur) this.slots[this.cur].on = 0;
    this.cur = this.rec;
    this.rec = -1;
    s.on = 1;
    s.r = 0;
    const total = s.n + s.x;
    for (let i = 0; i < total; i++) s.mono[i] = s.buf[0][i] + s.buf[1][i];
    s.size = Math.max(128, Math.min(Math.round(FRIDGE_GRAIN * sampleRate), total >> 1) & ~1);
    s.grains = [{ start: 0, i: 0 }, { start: 0, i: s.size }]; // the 2nd one starts half a grain later
    this.newGrain(s, s.grains[0], null);
    s.next = s.size >> 1;
  }

  process(inputs, outputs) {
    const inp = inputs[0];
    const out = outputs[0];
    const L = out[0];
    const R = out[1] ?? L;
    const inL = inp?.[0];
    const inR = inp?.[1] ?? inL;
    const up = 1 - Math.exp(-1 / (0.012 * sampleRate));
    const down = 1 - Math.exp(-1 / (0.09 * sampleRate));
    for (let i = 0; i < L.length; i++) {
      if (this.pend && currentFrame + i >= this.pend.at) {
        this.startRec(this.pend.len);
        this.pend = null;
      }
      if (this.rec >= 0) {
        const s = this.slots[this.rec];
        s.buf[0][this.w] = inL?.[i] ?? 0;
        s.buf[1][this.w] = inR?.[i] ?? 0;
        if (++this.w >= s.n + s.x) this.endRec();
      }
      this.levelNow += (this.level - this.levelNow) * 0.001;
      let l = 0;
      let r = 0;
      for (let k = 0; k < 2; k++) {
        const s = this.slots[k];
        if (k === this.rec || (!s.on && s.gain < 1e-4)) continue;
        s.gain += (s.on - s.gain) * (s.on > s.gain ? up : down);
        const b0 = s.buf[0];
        const b1 = s.buf[1];
        let a = 0;
        let b = 0;
        if (this.smooth) {
          if (--s.next < 0) {
            // every half grain: the grain that just ended starts again, lined up with the other one
            const [g0, g1] = s.grains;
            const done = g0.i >= s.size ? g0 : g1;
            this.newGrain(s, done, done === g0 ? g1 : g0);
            s.next = (s.size >> 1) - 1;
          }
          for (const g of s.grains) {
            if (g.i >= s.size) continue;
            const win = 0.5 - 0.5 * Math.cos((2 * Math.PI * g.i) / s.size);
            a += b0[g.start + g.i] * win;
            b += b1[g.start + g.i] * win;
            g.i++;
          }
        } else {
          const p = s.r;
          if (p < s.x) {
            // the bit recorded past the loop's end fades out under the loop's start fading in
            const t = (p / s.x) * (Math.PI / 2);
            const fin = Math.sin(t);
            const fout = Math.cos(t);
            a = b0[p] * fin + b0[s.n + p] * fout;
            b = b1[p] * fin + b1[s.n + p] * fout;
          } else {
            a = b0[p];
            b = b1[p];
          }
        }
        if (++s.r >= s.n) s.r = 0;
        l += a * s.gain;
        r += b * s.gain;
      }
      L[i] = l * this.levelNow;
      R[i] = r * this.levelNow;
    }
    return true;
  }
}

registerProcessor('bonfire-fridge', BonfireFridge);

// HALO: shimmer reverb. One per HALO module, fed by the module's send bus. The reverb is eight
// delay lines feeding each other (a feedback delay network) behind a few short smearing
// allpasses; DECAY sets how fast the lines die, TONE how fast their highs die, SIZE scales their
// lengths (changes glide, like a tape changing speed). The shimmer: the reverb's own output goes
// through a pitch shifter (two overlapping read heads moving through a short delay) and back into
// the reverb's input, so every trip round climbs by PITCH. Output = the reverb only.
const HALO_MS = [29.7, 37.1, 41.1, 43.7, 53.3, 59.9, 67.7, 73.1]; // line lengths at SIZE 0 x1 .. 1 x2.2
const HALO_AP_MS = [[4.7, 3.6, 12.7], [5.3, 3.1, 11.9]]; // per channel
const HALO_SHIFT = 0.085; // seconds, the pitch shifter's window
class BonfireHalo extends AudioWorkletProcessor {
  constructor() {
    super();
    const sr = sampleRate;
    this.cap = Math.ceil(sr * 0.18) + 8;
    this.lines = HALO_MS.map(() => new Float32Array(this.cap));
    this.len = HALO_MS.map(() => -1); // current (gliding) length of each line in frames
    this.damp = new Float32Array(8);
    this.y = new Float32Array(8);
    this.g = new Float32Array(8);
    this.w = 0;
    this.ap = HALO_AP_MS.map((ch) => ch.map((ms) => ({ buf: new Float32Array(Math.round((ms / 1000) * sr)), i: 0 })));
    this.scap = Math.ceil(sr * (HALO_SHIFT + 0.02)) + 8;
    this.sbuf = [new Float32Array(this.scap), new Float32Array(this.scap)];
    this.sw = 0;
    this.sph = 0;
    this.fb = [0, 0];
    this.fbLp = [0, 0];
    this.fbHp = [0, 0];
    this.lfo = 0;
    this.p = { shimmer: 0.5, decay: 6, size: 0.6, tone: 6000, pitch: 12, level: 0.7 };
    this.shimNow = 0.5;
    this.levelNow = 0.7;
    this.port.onmessage = (e) => {
      if (e.data.clear) {
        for (const b of [...this.lines, ...this.sbuf, ...this.ap.flat().map((a) => a.buf)]) b.fill(0);
        this.damp.fill(0);
        this.fb = [0, 0];
        this.fbLp = [0, 0];
        this.fbHp = [0, 0];
        return;
      }
      Object.assign(this.p, e.data);
    };
  }

  process(inputs, outputs) {
    const inp = inputs[0];
    const out = outputs[0];
    const L = out[0];
    const R = out[1] ?? L;
    const inL = inp?.[0];
    const inR = inp?.[1] ?? inL;
    const sr = sampleRate;
    const { p, lines, len, damp, y, g, cap, sbuf, scap } = this;
    const scale = 1 + Math.min(1, Math.max(0, p.size)) * 1.2;
    const decay = Math.min(30, Math.max(0.2, p.decay));
    const aDamp = 1 - Math.exp((-2 * Math.PI * Math.min(18000, Math.max(500, p.tone))) / sr);
    const aFbLp = 1 - Math.exp((-2 * Math.PI * Math.min(7000, Math.max(500, p.tone))) / sr);
    const aFbHp = 1 - Math.exp((-2 * Math.PI * 150) / sr);
    const glide = 1 - Math.exp(-1 / (0.15 * sr));
    const ratio = 2 ** ((p.pitch ?? 12) / 12);
    // a long DECAY makes the reverb louder: turn the feedback down to match, so SHIMMER feels the same
    const fbGain = HALO_FB / Math.sqrt(Math.min(4, Math.max(0.15, decay / 6)));
    const win = HALO_SHIFT * sr;
    const step = Math.abs(ratio - 1) / win;
    for (let k = 0; k < 8; k++) {
      const target = (HALO_MS[k] / 1000) * sr * scale;
      if (len[k] < 0) len[k] = target;
      g[k] = 10 ** ((-3 * (target / sr)) / decay);
    }
    for (let i = 0; i < L.length; i++) {
      this.shimNow += (p.shimmer - this.shimNow) * 0.0005;
      this.levelNow += (p.level - this.levelNow) * 0.001;
      this.lfo += 0.37 / sr;
      if (this.lfo >= 1) this.lfo -= 1;
      const wob = Math.sin(2 * Math.PI * this.lfo) * 6;
      // input + the shimmer coming back, smeared by the allpasses
      const x = [(inL?.[i] ?? 0) + this.fb[0], (inR?.[i] ?? 0) + this.fb[1]];
      for (let ch = 0; ch < 2; ch++) {
        let s = x[ch];
        for (const a of this.ap[ch]) {
          const d = a.buf[a.i];
          const v = s + d * 0.6;
          a.buf[a.i] = v;
          if (++a.i >= a.buf.length) a.i = 0;
          s = d - v * 0.6;
        }
        x[ch] = s;
      }
      // read the eight lines (two of them wobble a little, which keeps the tail from ringing)
      let sum = 0;
      for (let k = 0; k < 8; k++) {
        len[k] += ((HALO_MS[k] / 1000) * sr * scale - len[k]) * glide;
        let r = this.w - len[k] - (k === 1 ? wob : k === 6 ? -wob : 0);
        while (r < 0) r += cap;
        const i0 = r | 0;
        const fr = r - i0;
        const b = lines[k];
        const v = b[i0] + (b[i0 + 1 === cap ? 0 : i0 + 1] - b[i0]) * fr;
        damp[k] += (v - damp[k]) * aDamp;
        y[k] = damp[k];
        sum += y[k];
      }
      // every line feeds every other one (Householder mix), minus what DECAY takes away
      const mix = sum * 0.25;
      let oL = 0;
      let oR = 0;
      for (let k = 0; k < 8; k++) {
        lines[k][this.w] = (y[k] - mix) * g[k] + x[k & 1] * 0.5;
        if (k & 1) oR += y[k];
        else oL += y[k];
      }
      if (++this.w >= cap) this.w = 0;
      oL *= 0.5;
      oR *= 0.5;
      // pitch shifter on the reverb's output -> back into the input
      this.sph += step;
      if (this.sph >= 1) this.sph -= 1;
      const o = [oL, oR];
      for (let ch = 0; ch < 2; ch++) {
        const b = sbuf[ch];
        b[this.sw] = o[ch];
        let s = 0;
        for (let t = 0; t < 2; t++) {
          let ph = this.sph + t * 0.5;
          if (ph >= 1) ph -= 1;
          const d = 1 + (ratio > 1 ? 1 - ph : ph) * win;
          let r = this.sw - d;
          if (r < 0) r += scap;
          const i0 = r | 0;
          const fr = r - i0;
          const sn = Math.sin(Math.PI * ph);
          s += (b[i0] + (b[i0 + 1 === scap ? 0 : i0 + 1] - b[i0]) * fr) * sn * sn;
        }
        this.fbLp[ch] += (s - this.fbLp[ch]) * aFbLp;
        this.fbHp[ch] += (this.fbLp[ch] - this.fbHp[ch]) * aFbHp;
        this.fb[ch] = Math.tanh((this.fbLp[ch] - this.fbHp[ch]) * this.shimNow * fbGain);
      }
      if (++this.sw >= scap) this.sw = 0;
      L[i] = oL * this.levelNow * HALO_OUT;
      R[i] = oR * this.levelNow * HALO_OUT;
    }
    return true;
  }
}
const HALO_FB = 1.3; // how much of the shifted tail goes back in at SHIMMER 1 (DECAY 6 s)
const HALO_OUT = 0.5;

registerProcessor('bonfire-halo', BonfireHalo);

// STUTTER: beat repeat. One per STUTTER module, and unlike FRIDGE / HALO it is an insert: ALL the
// sound of the notes going through the module runs through here (they are silenced on their own
// way out), so it can cut the live sound off while it repeats. Normally the input passes straight
// through. { on: seconds, dur: seconds (0 = until told), at: time } : from `at`, the next `on`
// seconds pass through while being recorded, then that slice repeats (live input muted) until
// `dur` has passed since `at` or { off: true } arrives. FADE makes every repeat quieter.
const STUTTER_MAX = 1.6; // seconds: a 1/4 bar at 40 BPM
class BonfireStutter extends AudioWorkletProcessor {
  constructor() {
    super();
    const cap = Math.ceil(sampleRate * STUTTER_MAX) + 8;
    this.buf = [new Float32Array(cap), new Float32Array(cap)];
    this.cap = cap;
    this.state = 0; // 0 passing, 1 passing + recording, 2 repeating
    this.n = 0;
    this.w = 0;
    this.r = 0;
    this.rep = 0;
    this.end = Infinity;
    this.pend = null;
    this.passG = 1;
    this.loopG = 0;
    this.fade = 0;
    this.port.onmessage = (e) => {
      const d = e.data;
      if (d.fade != null) this.fade = d.fade;
      if (d.on != null) this.pend = { at: d.at != null ? Math.round(d.at * sampleRate) : 0, len: d.on, dur: d.dur || 0 };
      if (d.off) {
        this.pend = null;
        this.state = 0;
      }
    };
  }

  process(inputs, outputs) {
    const inp = inputs[0];
    const out = outputs[0];
    const L = out[0];
    const R = out[1] ?? L;
    const inL = inp?.[0];
    const inR = inp?.[1] ?? inL;
    const { buf } = this;
    const k = 1 - Math.exp(-1 / (0.003 * sampleRate)); // 3 ms switch-over, so cutting in and out doesn't click
    const perRep = 1 - 0.4 * Math.min(1, Math.max(0, this.fade));
    for (let i = 0; i < L.length; i++) {
      const f = currentFrame + i;
      if (this.pend && f >= this.pend.at) {
        this.n = Math.max(64, Math.min(this.cap - 8, Math.round(this.pend.len * sampleRate)));
        this.end = this.pend.dur > 0 ? f + Math.round(this.pend.dur * sampleRate) : Infinity;
        this.state = 1;
        this.w = 0;
        this.pend = null;
      }
      if (this.state && f >= this.end) this.state = 0;
      const xl = inL?.[i] ?? 0;
      const xr = inR?.[i] ?? 0;
      if (this.state === 1) {
        buf[0][this.w] = xl;
        buf[1][this.w] = xr;
        if (++this.w >= this.n) {
          this.state = 2;
          this.r = 0;
          this.rep = 1;
        }
      }
      const looping = this.state === 2;
      this.passG += ((looping ? 0 : 1) - this.passG) * k;
      this.loopG += ((looping ? 1 : 0) - this.loopG) * k;
      let l = xl * this.passG;
      let r = xr * this.passG;
      if (this.loopG > 1e-4 && this.n) {
        // each repeat: a 2 ms fade at both ends of the slice, FADE quieter than the one before
        const edge = Math.min(96, this.n >> 3);
        const p = this.r;
        const env = Math.min(1, p / edge, (this.n - p) / edge) * this.loopG * perRep ** this.rep;
        l += buf[0][p] * env;
        r += buf[1][p] * env;
        if (++this.r >= this.n) {
          this.r = 0;
          this.rep++;
        }
      }
      L[i] = l;
      R[i] = r;
    }
    return true;
  }
}

registerProcessor('bonfire-stutter', BonfireStutter);
