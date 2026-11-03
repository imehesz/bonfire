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
