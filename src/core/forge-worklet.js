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
