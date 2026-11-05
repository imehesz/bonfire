// Bonfire-only sounds: custom DSP registered into superdough, so patterns can play them with
// s("bf_string") etc. and every superdough effect (FILTER, FX, pan, gain, the recorder) still
// applies after them. strudel.cc doesn't have these sounds; the compiler flags them in the code view.
// Each sound = one AudioWorklet processor in forge-worklet.js, one node per note.
import { getAudioContext, getFrequencyFromValue, getSampleBuffer, getSound, registerSound } from '@strudel/webaudio';
import { getFontBufferSource } from '@strudel/soundfonts';
import workletUrl from './forge-worklet.js?url';

let loading = null;

// Call after the AudioContext exists (inside unlockAudio). Safe to call repeatedly.
export function loadForge() {
  return (loading ??= getAudioContext().audioWorklet.addModule(workletUrl).then(registerForgeSounds));
}

// Registers sound `name` played by worklet `processor`. opts(value) -> the processor's own knobs
// (may be async; null = skip the note); the timing (start / end / stop), pitch and attack / release
// are filled in here. tail(value) makes it a one-shot (drums): it ignores the note length and
// rings for tail seconds from its start.
function workletSound(name, processor, opts, { outGain = 0.5, defaultRelease = 0.3, channels = 1, tail = null } = {}) {
  registerSound(name, async (t, value, onended) => {
    const extra = await opts(value);
    if (!extra) return null;
    const ctx = getAudioContext();
    const duration = value.duration ?? 0.25;
    const release = value.release ?? defaultRelease;
    const stop = tail ? t + tail(value) + 0.05 : t + duration + release + 0.05;
    const node = new AudioWorkletNode(ctx, processor, {
      numberOfInputs: 0,
      outputChannelCount: [channels],
      processorOptions: {
        freq: getFrequencyFromValue(value),
        start: t,
        end: tail ? stop : t + duration,
        stop,
        attack: value.attack ?? 0,
        release,
        ...extra,
      },
    });
    const out = new GainNode(ctx, { gain: outGain });
    node.connect(out);
    let ended = false;
    node.port.onmessage = (e) => {
      if (e.data !== 'done' || ended) return;
      ended = true;
      node.disconnect();
      onended();
    };
    return { node: out, stop: (time) => node.port.postMessage({ stop: time }) };
  }, { type: 'synth', prebake: true });
}

// ---- DRUM: which octave each model plays in, its own pitch with nothing patched, its decay ----
export const DRUM_MODELS = [
  { lo: 41.2, def: 50, decay: 0.5 }, // KICK  E1..D#2
  { lo: 82.4, def: 110, decay: 0.6 }, // TOM   E2..D#3
  { lo: 146.8, def: 185, decay: 0.3 }, // SNARE D3..C#4 (the body)
  { lo: 0, def: 0, decay: 0.35 }, // CLAP  (noise only)
  { lo: 0, def: 0, decay: 0.12 }, // HAT   (metal + noise)
];
const drumModel = (v) => DRUM_MODELS[Math.min(4, Math.max(0, Math.round(v.drummodel ?? 0)))];
// DECAY 0..1 = x0.25..x4 of the model's own decay (0.5 = the classic length)
const drumDecay = (v) => drumModel(v).decay * 4 ** (2 * ((v.drumdecay ?? 0.5) - 0.5));

function drumOpts(v) {
  const m = drumModel(v);
  const tune = 2 ** ((v.drumtune ?? 0) / 12);
  // PITCH patched: the note's pitch class, played inside this drum's own octave (a kick never ends
  // up at 260 Hz just because the melody sits at C4). CLAP / HAT have no pitch: the note becomes
  // a 1..2 colour factor for their filters / metal instead.
  let freq = m.lo ? m.def : 1;
  if (v.drumkey) {
    const oct = Math.log2(getFrequencyFromValue(v) / (m.lo || 1));
    freq = (m.lo || 1) * 2 ** (oct - Math.floor(oct));
  }
  return {
    freq: freq * tune,
    model: Math.round(v.drummodel ?? 0),
    punch: v.drumpunch ?? 0.5,
    decay: drumDecay(v),
    tone: v.drumtone ?? 0.5,
    noise: v.drumnoise ?? 0,
    click: v.drumclick ?? 0.3,
    drive: v.drumdrive ?? 0.2,
  };
}

// ---- GRAIN: the worklet can't see superdough's decoded samples, so each sample's audio is sent to
// it once per AudioContext (mono, max 60 s) and cached there by id; later notes only send the id.
const bufIds = new WeakMap(); // AudioBuffer -> id
let nextBufId = 1;
const sentBufs = new WeakMap(); // AudioContext -> Set of ids already in the worklet

// Mono mixdown (max 60 s), with the faded-out tail cut off (below -36 dB of the loudest 50 ms) so POS
// spans the part you can hear (a 25 s piano note is mostly near-silence), and loudness-normalised
// so every sample comes out about as loud.
function grainData(buffer) {
  const n = Math.min(buffer.length, Math.round(buffer.sampleRate * 60));
  const mono = new Float32Array(n);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const ch = buffer.getChannelData(c);
    for (let i = 0; i < n; i++) mono[i] += ch[i] / buffer.numberOfChannels;
  }
  const win = Math.max(1, Math.round(buffer.sampleRate * 0.05));
  const rms = [];
  for (let a = 0; a < n; a += win) {
    let sum = 0;
    const b = Math.min(n, a + win);
    for (let i = a; i < b; i++) sum += mono[i] * mono[i];
    rms.push(Math.sqrt(sum / (b - a)));
  }
  const floor = Math.max(...rms) * 0.016;
  let last = rms.length - 1;
  while (last > 0 && rms[last] < floor) last--;
  const data = mono.slice(0, Math.min(n, (last + 1) * win));
  // loudness (RMS) normalised, so a sample with one sharp attack isn't quiet everywhere else;
  // capped so the loudest peak stays within +12 dB
  let peak = 1e-6;
  let sum = 0;
  for (const x of data) {
    peak = Math.max(peak, Math.abs(x));
    sum += x * x;
  }
  const gain = Math.min(0.25 / Math.sqrt(sum / data.length || 1e-12), 3.6 / peak);
  for (let i = 0; i < data.length; i++) data[i] *= gain;
  return data;
}

async function grainOpts(v) {
  const name = String(v.grainsrc ?? 'piano');
  const snd = getSound(name);
  let buffer;
  let playbackRate;
  if (snd?.data?.samples) {
    // note -> playbackRate exactly like a sample VOICE (no note = original pitch)
    ({ buffer, playbackRate } = await getSampleBuffer({ ...v, s: name, n: v.grainn ?? 0 }, snd.data.samples));
  } else if (snd?.data?.fonts?.length) {
    // GM soundfont: Strudel's loader picks the recording nearest the note and the rate for it.
    // The source node it hands back is never started; only its buffer and rate are used.
    const fonts = snd.data.fonts;
    const src = await getFontBufferSource(fonts[(v.grainn ?? 0) % fonts.length], v, getAudioContext());
    buffer = src.buffer;
    playbackRate = src.playbackRate.value;
  }
  if (!buffer) return null; // synth waves and noise have no recording to chop
  if (!bufIds.has(buffer)) bufIds.set(buffer, nextBufId++);
  const id = bufIds.get(buffer);
  const ctx = getAudioContext();
  if (!sentBufs.has(ctx)) sentBufs.set(ctx, new Set());
  const sent = sentBufs.get(ctx);
  let data = null;
  if (!sent.has(id)) {
    data = grainData(buffer);
    sent.add(id);
  }
  return {
    buf: id,
    data,
    bufRate: buffer.sampleRate,
    rate: playbackRate * 2 ** ((v.graintune ?? 0) / 12),
    pos: v.grainpos ?? 0.1,
    spray: v.grainspray ?? 0.1,
    scan: v.grainscan ?? 0,
    size: v.grainsize ?? 0.12,
    density: v.graindens ?? 18,
    shimmer: v.grainshim ?? 0,
    width: v.grainwidth ?? 0.6,
  };
}

function registerForgeSounds() {
  workletSound('bf_string', 'bonfire-string', (v) => ({
    decay: v.strdecay ?? 3,
    bright: v.strbright ?? 0.5,
    pick: v.strpick ?? 0.6,
  }));
  workletSound('bf_growl', 'bonfire-growl', (v) => ({
    wave: v.growlwave ?? 0,
    cutoff: v.growlcut ?? 400,
    res: v.growlres ?? 0.6,
    fm: v.growlfm ?? 2,
    ratio: v.growlratio ?? 1,
    fmdec: v.growldec ?? 0,
  }), { outGain: 0.8, defaultRelease: 0.1 });
  workletSound('bf_fold', 'bonfire-fold', (v) => ({
    fold: v.foldamt ?? 2,
    sym: v.foldsym ?? 0,
    bloom: v.foldbloom ?? 0,
    time: v.foldtime ?? 0.2,
  }), { outGain: 0.7, defaultRelease: 0.2 });
  workletSound('bf_acid', 'bonfire-acid', (v) => ({
    path: String(v.acidpath ?? '').split(',').filter(Boolean).map((s) => s.split(':').map(Number)),
    wave: v.acidwave ?? 0,
    cutoff: v.acidcut ?? 320,
    res: v.acidres ?? 0.75,
    envmod: v.acidenv ?? 0.55,
    decay: v.aciddec ?? 0.3,
    accent: v.acidacc ?? 0.6,
    glide: v.acidglide ?? 0.06,
  }), { outGain: 0.8, defaultRelease: 0.015 });
  workletSound('bf_modal', 'bonfire-modal', (v) => ({
    material: v.modalmat ?? 0,
    strike: v.modalstrike ?? 0.5,
    pos: v.modalpos ?? 0.2,
    decay: v.modaldecay ?? 1.5,
    damp: v.modaldamp ?? 0.5,
    stretch: v.modalstretch ?? 0,
  }), { outGain: 0.6, defaultRelease: 1 });
  workletSound('bf_hoover', 'bonfire-hoover', (v) => ({
    mode: v.hoovmode ?? 0,
    detune: v.hoovdet ?? 0.45,
    mix: v.hoovmix ?? 0.6,
    width: v.hoovwidth ?? 0.7,
    dip: v.hoovdip ?? 0,
    diptime: v.hoovdiptime ?? 0.15,
    sub: v.hoovsub ?? 0,
  }), { outGain: 0.7, defaultRelease: 0.3, channels: 2 });
  workletSound('bf_drum', 'bonfire-drum', drumOpts, { outGain: 0.9, tail: (v) => drumDecay(v) * (drumModel(v) === DRUM_MODELS[3] ? 1.2 : 1) + 0.06 });
  workletSound('bf_grain', 'bonfire-grain', grainOpts, { outGain: 0.8, defaultRelease: 1.5, channels: 2 });
}
