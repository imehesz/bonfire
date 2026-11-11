// The app's engine as a small public API, for pages that play patches without the rack (the
// BonfireSTACK Tracks listening site). The build publishes this as `engine.js` next to index.html
// with a FIXED name, so another site can load the newest engine straight from the app's URL:
//   const eng = await import('https://<app url>/engine.js');
//   await eng.play(patchJson);
// Keep the exports backwards compatible: sites out there call them without being rebuilt.
import * as engine from './core/engine.js';
import { compilePatch } from './core/compile.js';
import { MODULES, defaultParams } from './modules/index.js';
import { loadPack } from './core/samples.js';

export const API = 1; // bump only when an export changes meaning
export const VERSION = typeof __APP_VERSION__ === 'undefined' ? 'dev' : __APP_VERSION__;

let userVolume = 0.8;
let patchDb = -6; // the patch's own OUTPUT fader: part of how the track was mixed
let patchMuted = false;

function applyVolume() {
  const db = userVolume > 0.001 ? patchDb + 20 * Math.log10(userVolume) : -120;
  engine.setMaster(db, patchMuted || userVolume <= 0.001);
}

// Listener volume 0..1, on top of the patch's own OUTPUT volume.
export function setVolume(v) {
  userVolume = v;
  applyVolume();
}

// What the app does when it loads a file: drop module types this build doesn't know (a patch made
// with a newer BonfireSTACK), fill in every knob the file left at its default.
function normalize(raw) {
  const dropped = [...new Set(raw.modules.filter((m) => !MODULES[m.type]).map((m) => m.type))];
  const modules = raw.modules.filter((m) => MODULES[m.type]).map((m) => ({ ...m, params: { ...defaultParams(m.type), ...m.params } }));
  const ids = new Set(modules.map((m) => m.id));
  return { patch: { ...raw, modules, cables: (raw.cables ?? []).filter((c) => ids.has(c.from.m) && ids.has(c.to.m)) }, dropped };
}

// Starts patch `raw` from its first bar (call it from a click: browsers need one to start audio).
// Throws with a readable message if it can't make sound. Returns { warnings: [...], bpm }.
export async function play(raw) {
  const { patch, dropped } = normalize(raw);
  const compiled = compilePatch(patch);
  if (compiled.errors.length) throw new Error(compiled.errors.join(' · '));
  if (!compiled.playing) throw new Error('This track has nothing patched into its OUTPUT.');
  if (engine.isPlaying()) engine.stop();
  engine.fridgeReset(); // no leftover freeze / reverb tail from the previous track
  const out = patch.modules.find((m) => m.type === 'output');
  patchDb = out?.params.volume ?? -6;
  patchMuted = !!out?.params.mute;
  applyVolume();
  await Promise.all((patch.samplePacks ?? []).map((p) => Promise.resolve(loadPack(p)).catch(() => {})));
  engine.setCode(compiled.code);
  await engine.play();
  applyVolume();
  const warnings = [];
  if (dropped.length) warnings.push(`This track uses modules this player doesn't know yet (${dropped.join(', ')}); parts of it are missing.`);
  if (patch.localSounds?.length) warnings.push('This track uses samples that were never uploaded; parts of it are missing.');
  return { warnings, bpm: compiled.bpm };
}

export const pause = () => engine.stop();
export const resume = async () => {
  await engine.play();
  applyVolume();
};
export const isPlaying = () => engine.isPlaying();
// fn({ playing, loading, error }) on every change; returns an unsubscribe function
export const onState = (fn) => engine.onEngine(fn);
// AnalyserNode on the master output (for a scope), or null before the first play
export const scope = () => engine.analysers()?.mono ?? null;
