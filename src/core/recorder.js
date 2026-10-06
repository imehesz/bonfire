// WAV recorder. Taps the mix BEFORE the master VOLUME / MUTE (those are your
// speakers, not the music), so a quiet or muted OUTPUT still records full level.
// Audio is captured in real time on the audio thread and written as 16-bit stereo PCM.
import { getAudioContext, getSuperdoughAudioController } from '@strudel/webaudio';

// Runs on the audio thread: drops frames before `startAt` (an AudioContext time),
// batches the rest and posts them back. `stop` flushes what's left and ends it.
const WORKLET = `
class BonfireRec extends AudioWorkletProcessor {
  constructor() {
    super();
    this.startAt = Infinity;
    this.l = [];
    this.r = [];
    this.n = 0;
    this.done = false;
    this.port.onmessage = (e) => {
      if (e.data.startAt != null) this.startAt = e.data.startAt;
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
    this.l.push(inp[0].slice(from));
    this.r.push((inp[1] || inp[0]).slice(from));
    this.n += len - from;
    if (this.n >= 8192) this.flush();
    return true;
  }
}
registerProcessor('bonfire-rec', BonfireRec);
`;

let loaded = null;
let rec = null;

export const isRecording = () => !!rec;

// Seconds recorded so far (negative while waiting for the start bar), or null.
export function elapsed() {
  return rec ? getAudioContext().currentTime - rec.startAt : null;
}

export async function startRecording(startAt) {
  if (rec) return;
  const ctx = getAudioContext();
  await (loaded ??= ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }))));
  const node = new AudioWorkletNode(ctx, 'bonfire-rec', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    channelCount: 2,
    channelCountMode: 'explicit',
    channelInterpretation: 'discrete', // Strudel's mix lives on channels 0/1
  });
  const source = getSuperdoughAudioController().output.channelMerger;
  source.connect(node);
  node.connect(ctx.destination); // keeps the node pulled; it only ever outputs silence
  const chunks = [];
  node.port.onmessage = (e) => {
    if (e.data.l) chunks.push(e.data);
    if (e.data.done) rec?.resolve();
  };
  rec = { node, source, chunks, startAt: startAt ?? ctx.currentTime, rate: ctx.sampleRate };
  node.port.postMessage({ startAt: rec.startAt });
}

// Ends the take and returns it as a WAV Blob (null if nothing was captured).
export async function stopRecording() {
  if (!rec) return null;
  const r = rec;
  const done = new Promise((resolve) => (r.resolve = resolve));
  r.node.port.postMessage({ stop: true });
  await done;
  rec = null;
  try {
    r.source.disconnect(r.node);
  } catch { /* superdough rebuilt its output meanwhile */ }
  r.node.disconnect();
  return toWav(r.chunks, r.rate);
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
