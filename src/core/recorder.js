// WAV recorder. Taps the mix BEFORE the master VOLUME / MUTE (those are your
// speakers, not the music), so a quiet or muted OUTPUT still records full level.
// Audio is captured in real time on the audio thread and written as 16-bit stereo PCM.
// STEMS: one session can run several taps at once (the full mix + one per stem, each
// summing that stem's Strudel orbits), all starting and ending on the same sample.
import { getAudioContext, getSuperdoughAudioController } from '@strudel/webaudio';

// Runs on the audio thread: drops frames before `startAt` (an AudioContext time),
// batches the rest and posts them back. `stop` flushes what's left and ends it.
const WORKLET = `
class BonfireRec extends AudioWorkletProcessor {
  constructor() {
    super();
    this.startAt = Infinity;
    this.endAt = Infinity;
    this.l = [];
    this.r = [];
    this.n = 0;
    this.done = false;
    this.port.onmessage = (e) => {
      if (e.data.startAt != null) this.startAt = e.data.startAt;
      if (e.data.endAt != null) this.endAt = e.data.endAt;
      if (e.data.stop) {
        this.flush();
        this.done = true;
        this.port.postMessage({ done: true });
      }
    };
  }
  flush() {
    if (!this.n) return;
    const l = new Float32Array(this.n);
    const r = new Float32Array(this.n);
    let o = 0;
    for (let i = 0; i < this.l.length; i++) {
      l.set(this.l[i], o);
      r.set(this.r[i], o);
      o += this.l[i].length;
    }
    this.l = [];
    this.r = [];
    this.n = 0;
    this.port.postMessage({ l, r }, [l.buffer, r.buffer]);
  }
  process(inputs) {
    if (this.done) return false;
    const inp = inputs[0];
    if (!inp || !inp.length) return true;
    const len = inp[0].length;
    if (currentTime + len / sampleRate <= this.startAt) return true;
    const from = currentTime < this.startAt ? Math.round((this.startAt - currentTime) * sampleRate) : 0;
    // frame-exact end (the start frame + a whole number of frames), so every tap is the same length
    const endFrame = this.endAt === Infinity ? Infinity
      : Math.round(this.startAt * sampleRate) + Math.round((this.endAt - this.startAt) * sampleRate);
    const to = Math.max(from, Math.min(len, endFrame - Math.round(currentTime * sampleRate)));
    if (to > from) {
      this.l.push(inp[0].slice(from, to));
      this.r.push((inp[1] || inp[0]).slice(from, to));
      this.n += to - from;
    }
    if (to < len) {
      this.flush();
      this.done = true;
      this.port.postMessage({ done: true, ended: true });
      return false;
    }
    if (this.n >= 8192) this.flush();
    return true;
  }
}
registerProcessor('bonfire-rec', BonfireRec);
`;

let loaded = null;
let rec = null; // { taps: [{ name, node, sources, chunks, done }], startAt, endAt, rate }

export const isRecording = () => !!rec;
export const isStems = () => !!rec?.stems;

// Seconds recorded so far (negative while waiting for the start bar), or null.
export function elapsed() {
  return rec ? getAudioContext().currentTime - rec.startAt : null;
}
// Length of a timed take (stems) in seconds, or null for an open-ended REC.
export const length = () => (rec && rec.endAt != null ? rec.endAt - rec.startAt : null);

async function makeTap(ctx, name, sources) {
  await (loaded ??= ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }))));
  const node = new AudioWorkletNode(ctx, 'bonfire-rec', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    channelCount: 2,
    channelCountMode: 'explicit',
    channelInterpretation: 'discrete', // Strudel's mix lives on channels 0/1
  });
  for (const src of sources) src.connect(node); // several orbits into one tap = summed
  node.connect(ctx.destination); // keeps the node pulled; it only ever outputs silence
  const tap = { name, node, sources, chunks: [] };
  tap.finished = new Promise((resolve) => {
    node.port.onmessage = (e) => {
      if (e.data.l) tap.chunks.push(e.data);
      if (e.data.done) resolve();
    };
  });
  return tap;
}

async function begin(ctx, taps, startAt, endAt, stems = false) {
  rec = { taps, stems, startAt: startAt ?? ctx.currentTime, endAt: endAt ?? null, rate: ctx.sampleRate };
  for (const t of taps) t.node.port.postMessage({ startAt: rec.startAt, ...(endAt != null ? { endAt } : {}) });
}

export async function startRecording(startAt) {
  if (rec) return;
  const ctx = getAudioContext();
  const tap = await makeTap(ctx, 'mix', [getSuperdoughAudioController().output.channelMerger]);
  await begin(ctx, [tap], startAt);
}

// Stems: `stems` = [{ name, orbits: [n...] }]. Each gets a tap on the sum of its orbits' outputs
// (after the orbit's own reverb / delay / duck, before the master), plus `mix` = the full mix.
// Records from startAt to endAt (AudioContext times), then stops by itself.
export async function startStems(stems, { startAt, endAt, mix = true }) {
  if (rec) return;
  const ctx = getAudioContext();
  const ctrl = getSuperdoughAudioController();
  const taps = [];
  if (mix) taps.push(await makeTap(ctx, 'full mix', [ctrl.output.channelMerger]));
  for (const st of stems) {
    // creates the orbit now if nothing has played on it yet (same channels Strudel would use)
    taps.push(await makeTap(ctx, st.name, st.orbits.map((o) => ctrl.getOrbit(o, [0, 1]).output)));
  }
  await begin(ctx, taps, startAt, endAt, true);
  return Promise.all(taps.map((t) => t.finished)); // resolves when the take ends by itself
}

async function end() {
  const r = rec;
  rec = null;
  for (const t of r.taps) t.node.port.postMessage({ stop: true }); // no-op for taps already done
  await Promise.all(r.taps.map((t) => t.finished));
  for (const t of r.taps) {
    for (const src of t.sources) {
      try {
        src.disconnect(t.node);
      } catch { /* superdough rebuilt its output meanwhile */ }
    }
    t.node.disconnect();
  }
  return r;
}

// Ends the take and returns it as a WAV Blob (null if nothing was captured).
export async function stopRecording() {
  if (!rec) return null;
  const r = await end();
  return toWav(r.taps[0].chunks, r.rate);
}

// Ends a stems take: [{ name, blob }], silent stems dropped. All blobs have the same length.
export async function stopStems() {
  if (!rec) return [];
  const r = await end();
  return r.taps
    .filter((t) => t.chunks.some((c) => peak(c.l) > 1e-4 || peak(c.r) > 1e-4))
    .map((t) => ({ name: t.name, blob: toWav(t.chunks, r.rate) }))
    .filter((t) => t.blob);
}

function peak(a) {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i]));
  return m;
}

function toWav(chunks, rate) {
  const frames = chunks.reduce((n, c) => n + c.l.length, 0);
  if (!frames) return null;
  const buf = new ArrayBuffer(44 + frames * 4);
  const v = new DataView(buf);
  const str = (o, s) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + frames * 4, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true); // PCM chunk size
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 2, true); // stereo
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 4, true); // byte rate
  v.setUint16(32, 4, true); // block align
  v.setUint16(34, 16, true); // bits
  str(36, 'data');
  v.setUint32(40, frames * 4, true);
  let o = 44;
  const pcm = (x) => {
    const s = Math.max(-1, Math.min(1, x)); // hard clip anything over full scale
    return s < 0 ? s * 0x8000 : s * 0x7fff;
  };
  for (const { l, r } of chunks) {
    for (let i = 0; i < l.length; i++) {
      v.setInt16(o, pcm(l[i]), true);
      v.setInt16(o + 2, pcm(r[i]), true);
      o += 4;
    }
  }
  return new Blob([buf], { type: 'audio/wav' });
}
