// Bonfire-only sounds: custom DSP registered into superdough, so patterns can play them with
// s("bf_string") etc. and every superdough effect (FILTER, FX, pan, gain, the recorder) still
// applies after them. strudel.cc doesn't have these sounds; the compiler flags them in the code view.
// Each sound = one AudioWorklet processor in forge-worklet.js, one node per note.
import { getAudioContext, getFrequencyFromValue, getSampleBuffer, getSound, getSuperdoughAudioController, registerSound } from '@strudel/webaudio';
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
  workletSound('bf_fm', 'bonfire-fm', (v) => ({
    algo: v.fmalgo ?? 0,
    fb: v.fmfb ?? 0,
    ops: [0, 1, 2, 3].map((i) => [v[`fmr${i}`] ?? 1, v[`fml${i}`] ?? 0, v[`fma${i}`] ?? 0, v[`fmd${i}`] ?? 1]),
    hold: v.fmhold ? 1 : 0,
    sus: v.fmsus ?? 0.7,
    chorus: v.fmchorus ? 1 : 0,
    bright: v.fmbright ?? 0.5,
    time: v.fmtime ?? 0.5,
    metal: v.fmmetal ?? 0,
    soften: v.fmsoft ?? 0,
    acc: v.fmacc ?? 0,
  }), { outGain: 0.6, defaultRelease: 0.4, channels: 2 });
  workletSound('bf_grain', 'bonfire-grain', grainOpts, { outGain: 0.8, defaultRelease: 1.5, channels: 2 });
}

// ---- TAPE: one tape-loop worklet per TAPE module, fed by its superdough send bus ----
// Called for every event just before it plays (engine wraps the REPL output). Events that went
// through a TAPE carry bus 'bftape_<id>' + the tape* knobs. First event: make the loop, connect
// the bus into it and the loop into the orbit those notes play on (so stems / DUCK / recorder
// get the echoes too). Later events only push changed knobs. After a superdough reset (new buses
// and orbits) everything is re-wired on the next event.
const tapes = new Map(); // bus name -> { ctx, node, bus, orbit, key }
const TAPE_KEYS = [['tapetime', 'time'], ['tapeheads', 'heads'], ['tapefb', 'fb'], ['tapeecho', 'echo'], ['tapetone', 'tone'],
  ['tapeage', 'age'], ['tapesat', 'sat'], ['tapewow', 'wow']];

export function routeTape(v) {
  const name = v?.bus;
  if (typeof name !== 'string' || !name.startsWith('bftape_')) return;
  const ctx = getAudioContext();
  const ctrl = getSuperdoughAudioController();
  let t = tapes.get(name);
  if (!t || t.ctx !== ctx) {
    try {
      const node = new AudioWorkletNode(ctx, 'bonfire-tapebus', {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit',
      });
      t = { ctx, node, bus: null, orbit: null, key: '' };
      tapes.set(name, t);
    } catch {
      return; // worklet not loaded yet (audio still starting): the next event tries again
    }
  }
  const bus = ctrl.getBus(name);
  if (t.bus !== bus) {
    bus.connect(t.node);
    t.bus = bus;
  }
  const orbit = ctrl.nodes[v.orbit ?? 1]; // superdough makes the orbit when the first note plays
  if (orbit && t.orbit !== orbit) {
    if (t.orbit) t.node.disconnect();
    orbit.connectToOutput(t.node);
    t.orbit = orbit;
  }
  const knobs = Object.fromEntries(TAPE_KEYS.filter(([k]) => v[k] != null).map(([k, as]) => [as, v[k]]));
  const key = JSON.stringify(knobs);
  if (key !== t.key) {
    t.node.port.postMessage(knobs);
    t.key = key;
  }
}

// ---- BUS EFFECTS (FRIDGE, HALO, STUTTER, MIRAGE, SCORCH): one worklet per module that hears live audio ----
// Notes that went through such a module carry bfin = "kind:id" (several, comma-separated, when
// they are chained) and are sent into bus 'bfin_<id>' -> the module's worklet -> bus 'bfout_<id>'.
// The module also plays a held s("bus") note reading that out bus (tagged bfout = id, bfkind =
// kind, plus the module's knobs), so the effect's sound runs through whatever comes after the
// module (FILTER, FX, TAPE, MIXER) like any other sound.
// An `insert` kind (STUTTER, SCORCH) carries ALL of its notes' sound: the notes themselves are silenced on
// their way out (dry 0; only reverb / delay patched BEFORE the module still rings directly) and
// are otherwise only heard through the worklet.
// A step on a TRIG jack arrives as a soundless event tagged fridgetrig / stuttrig = id.
// busFxEvents(value, time) is called by the engine for every event: null = play it as it is, else
// the list of values to play instead (empty = nothing).
const BUS_FX = {
  fridge: { processor: 'bonfire-fridge', keys: [['fridgelvl', 'level'], ['fridgesmooth', 'smooth']] },
  halo: {
    processor: 'bonfire-halo',
    keys: [['haloshim', 'shimmer'], ['halodecay', 'decay'], ['halosize', 'size'], ['halotone', 'tone'], ['halopitch', 'pitch'], ['halolvl', 'level']],
  },
  stutter: { processor: 'bonfire-stutter', keys: [['stutfade', 'fade']], insert: true },
  scorch: {
    processor: 'bonfire-scorch',
    keys: [['scorchmode', 'mode'], ['scorchgain', 'gain'], ['scorchtone', 'tone'], ['scorchcab', 'cab'], ['scorchmix', 'mix'], ['scorchlvl', 'level']],
    insert: true,
  },
  mirage: { processor: 'bonfire-mirage', keys: [['mirmode', 'mode'], ['mirrate', 'rate'], ['mirdepth', 'depth'], ['mirwidth', 'width'], ['mirlvl', 'level']] },
};
const busFx = new Map(); // module id -> { ctx, node, kind, inBus, outBus, key, state, until }

function fxOf(id, kind) {
  const ctx = getAudioContext();
  let f = busFx.get(id);
  if (f?.ctx === ctx && f.kind === kind) return f;
  if (!BUS_FX[kind]) return null;
  try {
    const node = new AudioWorkletNode(ctx, BUS_FX[kind].processor, {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit',
    });
    f = { ctx, node, kind, inBus: null, outBus: null, key: '', state: 'off', until: 0 };
    busFx.set(id, f);
    return f;
  } catch {
    return null; // worklet not loaded yet (audio still starting)
  }
}

// superdough makes new buses after a reset: (re)connect whichever one changed
function wireFx(id, kind) {
  const f = fxOf(id, kind);
  if (!f) return null;
  const ctrl = getSuperdoughAudioController();
  const inBus = ctrl.getBus(`bfin_${id}`);
  const outBus = ctrl.getBus(`bfout_${id}`);
  if (f.inBus !== inBus) {
    inBus.connect(f.node);
    f.inBus = inBus;
  }
  if (f.outBus !== outBus) {
    if (f.outBus) f.node.disconnect();
    f.node.connect(outBus);
    f.outBus = outBus;
  }
  return f;
}

export function busFxEvents(v, t) {
  if (v?.bfout == null && v?.bfin == null && v?.fridgetrig == null && v?.stuttrig == null) return null;
  if (v.stuttrig != null) {
    stutterOn(String(v.stuttrig), v.stutlen ?? 0.125, v.stutdur ?? 0, t);
    return [];
  }
  if (v.fridgetrig != null) {
    // a step on the TRIG jack: freeze at that step's own time. The event itself makes no sound.
    const f = wireFx(String(v.fridgetrig), 'fridge');
    if (f) {
      const seconds = v.fridgelen ?? 0.5;
      f.node.port.postMessage({ freeze: seconds, at: t });
      f.state = 'rec';
      f.until = performance.now() + (Math.max(0, (t ?? 0) - f.ctx.currentTime) + seconds) * 1000 + 40;
    }
    return [];
  }
  if (v.bfout != null) {
    // the held note that plays the effect's output: it carries the knobs
    const kind = String(v.bfkind);
    const f = wireFx(String(v.bfout), kind);
    if (f) {
      const knobs = Object.fromEntries(BUS_FX[kind].keys.filter(([k]) => v[k] != null).map(([k, as]) => [as, Number(v[k])]));
      const key = JSON.stringify(knobs);
      if (key !== f.key) {
        f.node.port.postMessage(knobs);
        f.key = key;
      }
    }
  }
  if (v.bfin == null) return null;
  // the send leaves the note after its postgain (a MIXER level further down): undo what was added
  // after the module, so the effect hears the note as loud as it was going in
  const post = v.postgain ?? 1;
  const busgain = post > 1e-3 ? Math.min(8, (v.bfpg ?? 1) / post) : 1;
  const out = [];
  const entries = String(v.bfin).split(',').map((x) => x.split(':')).filter(([kind, id]) => wireFx(id, kind));
  // through an insert the note is never heard directly, only as silent sends into the worklets
  const insert = entries.some(([kind]) => BUS_FX[kind].insert);
  let own = v.bus == null && !insert; // a note has ONE send: free = use it, taken (a TAPE further down) = a silent copy
  if (!own && !insert) out.push(v);
  // an insert's note keeps the reverb / delay it had BEFORE the module (those ring on untouched);
  // any added after the module belong to the held note that plays the module's output
  let sends = insert ? { room: v.bfroom ?? 0, delay: v.bfdelay ?? 0 } : { room: 0, delay: 0 };
  for (const [, id] of entries) {
    const send = { ...v, bus: `bfin_${id}`, busgain };
    out.push(own ? send : { ...send, dry: 0, ...sends });
    own = false;
    sends = { room: 0, delay: 0 };
  }
  return out.length ? out : null;
}

// FRIDGE: 'off' | 'rec' (recording the slice) | 'on' (playing it)
export function fridgeState(id) {
  const f = busFx.get(id);
  if (!f || f.state === 'off') return 'off';
  if (f.state === 'rec' && performance.now() >= f.until) f.state = 'on';
  return f.state;
}

// The FREEZE button: record `seconds` of what is coming in and loop it; pressed again = let go.
export function fridgeToggle(id, seconds) {
  const f = wireFx(id, 'fridge');
  if (!f) return 'off';
  if (fridgeState(id) === 'off') {
    f.node.port.postMessage({ freeze: seconds });
    f.state = 'rec';
    f.until = performance.now() + seconds * 1000 + 40;
  } else {
    f.node.port.postMessage({ release: true });
    f.state = 'off';
  }
  return f.state;
}

// STUTTER: start repeating slices of `len` seconds at audio time `at`, for `dur` seconds (0 = until
// stutterOff). 'on' | 'off'.
export function stutterOn(id, len, dur, at) {
  const f = wireFx(id, 'stutter');
  if (!f) return;
  f.node.port.postMessage({ on: len, dur, at });
  f.state = 'on';
  f.until = dur > 0 ? performance.now() + (Math.max(0, (at ?? 0) - f.ctx.currentTime) + dur) * 1000 : Infinity;
}

export function stutterOff(id) {
  const f = busFx.get(id);
  if (!f) return;
  f.node.port.postMessage({ off: true });
  f.state = 'off';
}

export function stutterState(id) {
  const f = busFx.get(id);
  if (!f || f.kind !== 'stutter' || f.state === 'off') return 'off';
  if (performance.now() >= f.until) f.state = 'off';
  return f.state;
}

// A newly loaded patch starts with nothing frozen, no stutter and no old reverb tail.
export function fridgeReset() {
  for (const f of busFx.values()) {
    if (f.kind === 'halo') f.node.port.postMessage({ clear: true });
    else if (f.kind === 'stutter') f.node.port.postMessage({ off: true });
    else if (f.state !== 'off') f.node.port.postMessage({ release: true });
    f.state = 'off';
  }
}
