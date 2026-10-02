// Audio engine: Strudel REPL, the strudel.cc sample prebake, transport, and the
// hardware-side output stage (master volume / mute / analysers for the scope).
import {
  aliasBank, getAudioContext, getSuperdoughAudioController, initAudio, registerZZFXSounds, samples, soundMap, superdough,
} from '@strudel/webaudio';
import { initStrudel } from './strudel.js';
import { registerSoundfonts } from '@strudel/soundfonts';
import dirtSubset from './dirt-subset.json';

const CDN = 'https://strudel.b-cdn.net';

let repl = null;
let audioInit = null;
let ready = null;
let playing = false;
let lastCode = '';
let pending = null;
let timer = null;
const listeners = new Set();
const state = { error: null, loading: true };

function emit() {
  for (const fn of listeners) fn({ playing, ...state });
}
export const onEngine = (fn) => (listeners.add(fn), () => listeners.delete(fn));
export const isPlaying = () => playing;

// Same sample universe as strudel.cc, so every name in generated code exists there too.
async function prebake() {
  await Promise.all([
    registerZZFXSounds(),
    registerSoundfonts(),
    samples(`${CDN}/piano.json`, `${CDN}/piano/`, { prebake: true }),
    samples(`${CDN}/vcsl.json`, `${CDN}/VCSL/`, { prebake: true }),
    samples(`${CDN}/tidal-drum-machines.json`, `${CDN}/tidal-drum-machines/machines/`, { prebake: true, tag: 'drum-machines' }),
    samples(`${CDN}/uzu-drumkit.json`, `${CDN}/uzu-drumkit/`, { prebake: true, tag: 'drum-machines' }),
    samples(`${CDN}/uzu-wavetables.json`, `${CDN}/uzu-wavetables/`, { prebake: true }),
    samples(`${CDN}/mridangam.json`, `${CDN}/mrid/`, { prebake: true, tag: 'drum-machines' }),
    samples(dirtSubset, `${CDN}/Dirt-Samples/`, { prebake: true }),
  ]);
  await aliasBank(`${CDN}/tidal-drum-machines-alias.json`);
}

export function boot() {
  if (ready) return ready;
  ready = initStrudel({
    prebake,
    onEvalError: (e) => {
      state.error = e?.message ?? String(e);
      emit();
    },
    afterEval: () => {
      if (state.error) {
        state.error = null;
        emit();
      }
    },
  }).then((r) => {
    repl = r;
    state.loading = false;
    emit();
    return r;
  });
  return ready;
}

// Must be called from inside a user gesture (the splash buttons / PLAY).
export async function unlockAudio() {
  const ctx = getAudioContext();
  if (ctx.state !== 'running') await ctx.resume();
  await (audioInit ??= initAudio()); // loads the AudioWorklets (supersaw, crush, ...)
  await boot();
  attachOutputStage();
}

async function evaluateNow(code) {
  if (!repl) return;
  try {
    await repl.evaluate(code, true);
  } catch (e) {
    state.error = e.message;
    emit();
  }
}

// Debounced so a knob drag re-evaluates ~12x a second, not on every pixel.
export function setCode(code, { immediate = false } = {}) {
  lastCode = code;
  if (!playing) return;
  pending = code;
  if (immediate) {
    clearTimeout(timer);
    timer = null;
    evaluateNow(pending);
    return;
  }
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    evaluateNow(pending);
  }, 80);
}

export async function play() {
  await unlockAudio();
  playing = true;
  emit();
  await evaluateNow(lastCode);
}

export function stop() {
  playing = false;
  repl?.stop();
  emit();
}

export const togglePlay = () => (playing ? stop() : play());

// Current position in cycles (fractional), or null when stopped.
export function now() {
  if (!playing || !repl) return null;
  try {
    return repl.scheduler.now();
  } catch {
    return null;
  }
}

// Audition a single sound from the library.
export async function audition(value) {
  await unlockAudio();
  const ctx = getAudioContext();
  superdough({ n: 0, gain: 0.9, ...value }, ctx.currentTime + 0.05, 0.5);
}

export const listSounds = () => soundMap.get();

// ---- output stage (outside the pattern = outside the generated code) ----
const stage = { node: null, splitter: null, mono: null, left: null, right: null, gainDb: 0, muted: false };

function attachOutputStage() {
  const ctrl = getSuperdoughAudioController();
  const node = ctrl.output.destinationGain;
  if (!node || node === stage.node) return;
  const ctx = getAudioContext();
  stage.node = node;
  stage.mono = ctx.createAnalyser();
  stage.mono.fftSize = 2048;
  stage.mono.minDecibels = -90; // spectrum scope range; a full mix sits well inside it
  stage.mono.maxDecibels = -6;
  stage.left = ctx.createAnalyser();
  stage.right = ctx.createAnalyser();
  stage.left.fftSize = stage.right.fftSize = 1024;
  stage.splitter = ctx.createChannelSplitter(2);
  node.connect(stage.mono);
  node.connect(stage.splitter);
  stage.splitter.connect(stage.left, 0);
  stage.splitter.connect(stage.right, 1);
  applyGain();
}

function applyGain() {
  if (!stage.node) return;
  const g = stage.muted ? 0 : 10 ** (stage.gainDb / 20);
  stage.node.gain.setTargetAtTime(g, getAudioContext().currentTime, 0.02);
}

export function setMaster(db, muted) {
  stage.gainDb = db;
  stage.muted = muted;
  applyGain();
}

// superdough can rebuild its output on reset; re-tap when that happens.
export function analysers() {
  if (stage.node && getSuperdoughAudioController().output.destinationGain !== stage.node) attachOutputStage();
  return stage.node ? stage : null;
}

export { lastCode };
