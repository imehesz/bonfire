// MIDI control: MIDI LEARN (any knob / switch / button <- any CC, key or wheel)
// and NOTE ENTRY (play keys to write a MELODY's steps or a CHORDS progression).
// Mappings live in the patch (patch.midiMap), so they save and share with it.
import { MODULES } from '../modules/index.js';
import { CHORD_QUALITIES, CHORD_SLOTS, chordPlan } from '../modules/sources.js';
import { ROOTS, midiToNote, scaleSteps } from '../core/music.js';
import { checkpoint, findModule, getPatch, mergeMidiMaps, removeMidiMap, setMidiMap, setMidiMode, setParam, subscribe } from '../core/store.js';
import { pickPatchFile } from '../core/persist.js';
import * as engine from '../core/engine.js';
import { disableMidi, enableMidi, midiState, onMidi, onMidiDropped, onMidiState, restoreMidi, srcLabel } from '../core/midi.js';
import { formatValue, fromNorm, toNorm } from './controls.js';
import { h, modal, setReadout, toast } from './dom.js';

const LEARNABLE = ['knob', 'rotary', 'fader', 'switch', 'select', 'toggle'];
export const GLOBALS = { play: 'PLAY / STOP', rest: 'NOTE ENTRY · REST', back: 'NOTE ENTRY · BACK' };
const ENTRY_TYPES = ['melody', 'chords'];
const MELODY_MAX = 14;

let learning = null; // { m, k } waiting for a control to move
let learnMode = false; // click-to-arm: every click on a control starts learning it
let lastMsg = null;
const rawHistory = new Map(); // src -> last 16 CC bytes, shown in the panel to diagnose knobs
const refreshers = new Set(); // open panels / badges that redraw on any change
const refresh = () => refreshers.forEach((fn) => fn());

// The module NOTE ENTRY writes into, and the step it writes next.
export const noteEntry = { id: null, cursor: 0 };

// ---------------- targets ----------------
function targetDef(m, k) {
  if (m === '@') return GLOBALS[k] ? { kind: 'global' } : null;
  const mod = findModule(m);
  const def = mod && MODULES[mod.type];
  if (!def) return null;
  if (def.actions?.[k]) return { kind: 'action', a: def.actions[k] };
  const p = def.params[k];
  return p && LEARNABLE.includes(p.kind) ? { kind: 'param', p } : null;
}

export const isLearnable = (m, k) => !!targetDef(m, k);

export function targetLabel(m, k) {
  if (m === '@') return GLOBALS[k] ?? k;
  const mod = findModule(m);
  const def = mod && MODULES[mod.type];
  const label = def?.actions?.[k]?.label ?? def?.params[k]?.label ?? k;
  return `${(mod?.label || m).toUpperCase()} · ${label}`;
}

const mapFor = (m, k) => getPatch().midiMap?.find((x) => x.m === m && x.k === k);

// ---------------- learn ----------------
export function startLearn(m, k) {
  learning = { m, k };
  if (!midiState().enabled) enableMidi();
  toast(`MIDI LEARN: move a knob, fader or key on your controller for ${targetLabel(m, k)}`);
  refresh();
}

export function cancelLearn() {
  learning = null;
  refresh();
}

export function setLearnMode(on) {
  learnMode = on;
  learning = null;
  document.body.classList.toggle('midi-learn', on);
  banner.hidden = !on;
  if (on && !midiState().enabled) enableMidi();
  refresh();
}

const bannerText = h('span', {}, '');
const banner = h('div', { class: 'midi-banner', hidden: true },
  h('b', {}, 'MIDI LEARN'), bannerText,
  h('button', { class: 'btn accent', onclick: () => setLearnMode(false) }, 'DONE'));
document.body.append(banner);
refreshers.add(() => {
  bannerText.textContent = learning
    ? `${targetLabel(learning.m, learning.k)} — now move a control on your MIDI device`
    : 'Click a knob, switch or button, then move a control on your MIDI device';
});

// In learn mode a click on a control arms it instead of moving it.
document.addEventListener('pointerdown', (e) => {
  if (!learnMode || e.button !== 0) return;
  const ctl = e.target.closest?.('.module .ctl[data-param], .module .ctl.button[data-action]');
  if (!ctl) return;
  const m = ctl.closest('.module').dataset.id;
  const k = ctl.dataset.param ?? ctl.dataset.action;
  if (!isLearnable(m, k)) return;
  e.preventDefault();
  e.stopPropagation();
  learning = { m, k };
  refresh();
}, true);
document.addEventListener('click', (e) => {
  if (learnMode && e.target.closest?.('.module .ctl')) {
    e.preventDefault();
    e.stopPropagation();
  }
}, true);
document.addEventListener('keydown', (e) => e.key === 'Escape' && (learnMode ? setLearnMode(false) : learning && cancelLearn()));

function learn(msg) {
  const { m, k } = learning;
  const t = targetDef(m, k);
  if (!t) return cancelLearn();
  // ignore the release of the key that was just learned; but a pad that only ever
  // sends velocity 0 (the SMK-37's, as set up) has no press, so its "release" is the press
  if (msg.kind === 'note' && !msg.on && performance.now() - (noteOnAt.get(msg.src) ?? -1e9) < 3000) return;
  // a key has no position, so it can only press buttons or step through choices
  if (msg.kind === 'note' && t.kind === 'param' && !t.p.options && t.p.kind !== 'toggle') {
    toast(`${targetLabel(m, k)} needs a knob or fader — keys can only press buttons and switches`, 'warn');
    return;
  }
  learning = null;
  setMidiMap(msg.src, m, k);
  toast(`${targetLabel(m, k)}  ←  ${srcLabel(msg.src)}`);
  refresh();
}

// ---------------- incoming messages ----------------
const lastValue = new Map(); // src -> { v: last 0..1, t }, for button presses
const pending = new Map(); // 'm.k' -> value, flushed once per frame
const lastTouch = new Map(); // 'm.k' -> time, so one twist of a knob is one undo step
let raf = 0;

function flush() {
  raf = 0;
  const now = performance.now();
  for (const [key, { m, k, v }] of pending) {
    const mod = findModule(m);
    if (!mod || mod.params[k] === v) continue;
    if (now - (lastTouch.get(key) ?? -1e9) > 800) checkpoint();
    lastTouch.set(key, now);
    setParam(m, k, v, { record: false });
    setReadout(`${formatValue(targetDef(m, k).p, v)} · ${targetLabel(m, k)} · MIDI`);
  }
  pending.clear();
}

function pressAction(m, k, a) {
  const btn = document.querySelector(`.module[data-id="${m}"] .ctl.button[data-action="${k}"] button`);
  if (!btn) return;
  if (a.click) btn.click();
  else btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
}

// ---- endless encoders ----
// They send clicks, not positions. Once click size is measured (below), every
// common code comes down to which half means "right":
//   lo  1..63 = right, 65..127 = left   (sign-magnitude, two's complement)
//   hi  65..127 = right, 1..63 = left   (binary offset 63/65, the SMK-37's 69/1)
export const REL_MODES = ['abs', 'lo', 'hi'];
export const REL_LABEL = { abs: 'KNOB', lo: 'ENDLESS', hi: 'ENDLESS REV' };
const family = (rel) => (rel === 'hi' || rel === 'signhi' || rel === 'offset' ? 'hi' : 'lo'); // + names from earlier builds

// Signed click size: the distance from the edge of its half, so 1 / 127 / 65 / 63
// all mean one click in their code.
function relCode(rel, raw) {
  if (raw === 64 || raw === 0) return 0;
  if (family(rel) === 'lo') return raw < 64 ? raw : -(raw >= 96 ? 128 - raw : raw - 64);
  return raw > 64 ? raw - 64 : -(raw >= 32 ? 64 - raw : raw);
}

// Some encoders send a fixed value per click (the SMK-37: 69 one way, 1 the
// other), so the raw size means nothing. The smallest size seen in each
// direction counts as one click; encoders that speed up still go faster.
const clickSize = new Map(); // 'src+' / 'src-' -> smallest |code| seen
function relDelta(src, rel, raw) {
  const d = relCode(rel, raw);
  if (!d) return 0;
  const key = src + (d > 0 ? '+' : '-');
  const one = Math.min(clickSize.get(key) ?? Infinity, Math.abs(d));
  clickSize.set(key, one);
  relDelta.last = Math.sign(d) * Math.max(1, Math.round(Math.abs(d) / one));
  return relDelta.last;
}

// The direction picked by hand last time, so every other knob on the same
// controller turns the right way without picking again. Per browser.
const PREF_REL = 'bonfire.midi.rel';
const preferredRel = () => {
  try { return localStorage.getItem(PREF_REL); } catch { return null; }
};
export function chooseMidiMode(src, rel) {
  setMidiMode(src, rel);
  clickSize.delete(`${src}+`);
  clickSize.delete(`${src}-`);
  if (rel !== 'lo' && rel !== 'hi') return;
  try { localStorage.setItem(PREF_REL, rel); } catch { /* ignore */ }
  // the other encoders were only guessed, and they're on the same controller: flip them too
  for (const x of getPatch().midiMap) {
    if (x.src !== src && x.auto && x.rel && x.rel !== 'abs' && family(x.rel) !== rel) setMidiMode(x.src, rel, { auto: true, record: false });
  }
}

// A knob with ends only sends when it moves, so it never repeats a value; an
// encoder repeats its click value. Decided ONCE per mapping (a guess that changed
// mid-turn reversed the knob): the hand-picked direction if there is one, else
// values hugging 64 = hi (63/65 offset code), anything else = lo.
const seen = new Map(); // src -> last 3 raw values
function guessRel(src, raw) {
  const last = [...(seen.get(src) ?? []).slice(-2), raw];
  seen.set(src, last);
  if (last.length < 3 || !last.every((v) => v === raw) || [0, 64, 127].includes(raw)) return null;
  seen.delete(src);
  const pref = preferredRel();
  if (pref === 'lo' || pref === 'hi') return pref; // older builds stored other names: ignore them
  return raw >= 56 && raw <= 72 && raw !== 64 && Math.abs(raw - 64) <= 3 ? 'hi' : 'lo';
}

const burstStart = new Map(); // 'm.k' -> value before an undecided CC started moving it

// PLAY / STOP on a CC: an endless knob plays when turned right and stops when
// turned left; a button (127 / 0) toggles. Until we know which it is, in-between
// values only feed the guess, so the first turn of a knob can't toggle by accident.
function playFromCC(map, msg, pressed) {
  let rel = map.rel;
  if (rel == null) {
    const g = guessRel(msg.src, msg.raw);
    if (g) {
      rel = g;
      setMidiMode(msg.src, g, { auto: true, record: false });
    } else if (msg.raw !== 0 && msg.raw !== 127) return;
  }
  if (rel && rel !== 'abs') {
    const d = relDelta(msg.src, rel, msg.raw);
    if (d > 0 && !engine.isPlaying()) engine.play();
    else if (d < 0 && engine.isPlaying()) engine.stop();
    return;
  }
  if (pressed) engine.togglePlay();
}

// ---- controller profiles: mappings as a file, reusable in any patch ----
// Each mapping keeps its module TYPE, so a profile made on 'filter1' lands on
// whatever FILTER the other patch has (same id first, then the first of that type).
function exportProfile() {
  const maps = getPatch().midiMap ?? [];
  if (!maps.length) return toast('Nothing to export yet — map some knobs first', 'warn');
  const device = midiState().devices[0] ?? 'controller';
  const profile = {
    format: 'bonfire-midi',
    version: 1,
    controller: device,
    direction: preferredRel(),
    maps: maps.map((x) => ({ ...x, type: x.m === '@' ? '@' : findModule(x.m)?.type, auto: undefined })),
  };
  const blob = new Blob([JSON.stringify(profile, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${device.replace(/[^\w-]+/g, '-').toLowerCase()}.bonfire-midi.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast(`Saved ${a.download}`);
}

// Modules nearest the sound first: walk the cables back from OUTPUT, so the
// MIXER that feeds OUTPUT comes before a sub-mixer feeding it. Unpatched last.
function byClosenessToOutput() {
  const patch = getPatch();
  const order = [];
  const seen = new Set();
  let ring = patch.modules.filter((m) => m.type === 'output').map((m) => m.id);
  while (ring.length) {
    const next = [];
    for (const id of ring) {
      if (seen.has(id)) continue;
      seen.add(id);
      order.push(id);
      for (const c of patch.cables) if (c.to.m === id && !seen.has(c.from.m)) next.push(c.from.m);
    }
    ring = next;
  }
  return [...order, ...patch.modules.map((m) => m.id).filter((id) => !seen.has(id))].map(findModule);
}

// A built-in preset goes by the patch's wiring only; an imported profile keeps
// the same module id when the patch has it (the patch it was made on).
export function applyProfile(profile, { preset = false } = {}) {
  if (profile?.format !== 'bonfire-midi' || !Array.isArray(profile.maps)) throw new Error('not a Bonfire MIDI profile');
  const mods = byClosenessToOutput();
  const used = new Set();
  const out = [];
  const skipped = [];
  for (const x of profile.maps) {
    let m = null;
    if (x.m === '@') m = '@';
    else if (!preset && findModule(x.m)?.type === x.type && !used.has(`${x.m}.${x.k}`)) m = x.m;
    else m = mods.find((mod) => mod.type === x.type && !used.has(`${mod.id}.${x.k}`))?.id ?? null;
    if (!m || !isLearnable(m, x.k)) {
      skipped.push(`${(x.type ?? "?").toUpperCase()} · ${x.k.toUpperCase()}`);
      continue;
    }
    used.add(`${m}.${x.k}`);
    out.push({ src: x.src, m, k: x.k, rel: x.rel });
  }
  mergeMidiMaps(out);
  if (profile.direction === 'lo' || profile.direction === 'hi') {
    try { localStorage.setItem(PREF_REL, profile.direction); } catch { /* ignore */ }
  }
  return { applied: out.length, skipped };
}

// Built-in controller presets: src/midi-presets/*.json, matched by device name.
export const PRESETS = Object.values(import.meta.glob('../midi-presets/*.json', { eager: true, import: 'default' }))
  .sort((a, b) => a.name.localeCompare(b.name));
const presetFor = (device) => PRESETS.find((p) => device.toLowerCase().includes(p.match.toLowerCase()));

function loadPreset(pr) {
  const { applied, skipped } = applyProfile(pr, { preset: true });
  toast(`${pr.name} preset: ${applied} control${applied === 1 ? '' : 's'} mapped${skipped.length ? ` · not in this patch: ${skipped.join(', ')}` : ''} (Ctrl+Z undoes it)`, applied ? '' : 'warn');
}

// A known controller plugged into a patch with nothing mapped: point at its preset, once.
let hinted = false;
onMidiState((st) => {
  if (hinted || !st.enabled || (getPatch().midiMap ?? []).length) return;
  const pr = st.devices.map(presetFor).find(Boolean);
  if (!pr) return;
  hinted = true;
  toast(`${pr.name} connected — load its layout: MIDI → Presets`);
});

async function importProfile() {
  try {
    const { applied, skipped } = applyProfile(await pickPatchFile());
    toast(`MIDI profile: ${applied} mapping${applied === 1 ? '' : 's'} applied${skipped.length ? ` · skipped (not in this patch): ${skipped.join(', ')}` : ''}`, skipped.length ? 'warn' : '');
  } catch (e) {
    toast(`Could not import: ${e.message}`, 'warn');
  }
}

// Forgetting a mapping asks first, so a slipped click can't lose it.
function confirmForget(question, match) {
  const dlg = modal(h('div', { class: 'confirm' },
    h('p', {}, question),
    h('div', { class: 'confirm-actions' },
      h('button', { class: 'btn', onclick: () => dlg.close() }, 'KEEP'),
      h('button', { class: 'btn accent', onclick: () => { removeMidiMap(match); dlg.close(); } }, 'FORGET'))), { className: 'modal-confirm' });
}

// Right-click menu for the topbar PLAY button.
export function playMenuItems() {
  const map = mapFor('@', 'play');
  const items = [{ label: 'MIDI learn: PLAY / STOP', hint: map ? srcLabel(map.src) : '', action: () => startLearn('@', 'play') }];
  if (map?.rel && map.rel !== 'abs') items.push({ label: 'Reverse knob direction', hint: 'MIDI', action: () => chooseMidiMode(map.src, family(map.rel) === 'lo' ? 'hi' : 'lo') });
  if (map) items.push({ label: 'Forget MIDI: PLAY / STOP', action: () => confirmForget(`Forget the MIDI ${srcLabel(map.src)} → PLAY / STOP mapping?`, (x) => x.src === map.src) });
  return items;
}

function apply(map, msg) {
  const { m, k } = map;
  const t = targetDef(m, k);
  if (!t) return;
  const prev = lastValue.get(msg.src) ?? { v: 0, t: -1e9 };
  const v = msg.kind === 'note' ? (msg.on ? 1 : 0) : msg.value;
  const now = performance.now();
  lastValue.set(msg.src, { v, t: now });
  // Every key-down is a press: some buttons never send the key-up (the SMK-37's
  // transport keys). A CC button presses on the way up, or on a repeat of 127
  // after a pause, for buttons that only ever send 127.
  const pressed = msg.kind === 'note' ? msg.on || !noteOnAt.has(msg.src) : v >= 0.5 && (prev.v < 0.5 || now - prev.t > 250);
  if (t.kind === 'global' && k === 'play' && msg.kind === 'cc') return playFromCC(map, msg, pressed);
  if (t.kind === 'global') {
    if (!pressed) return;
    if (k === 'play') engine.togglePlay();
    else if (k === 'rest') entryRest();
    else if (k === 'back') moveCursor(-1);
    return;
  }
  if (t.kind === 'action') {
    if (pressed) pressAction(m, k, t.a);
    return;
  }
  const p = t.p;
  const key = `${m}.${k}`;
  let cur = pending.has(key) ? pending.get(key).v : findModule(m).params[k];
  let rel = map.rel;
  if (msg.kind === 'cc' && rel == null) {
    if (rel == null && performance.now() - (lastTouch.get(key) ?? -1e9) > 800 && !pending.has(key)) burstStart.set(key, cur);
    const g = guessRel(msg.src, msg.raw);
    if (g && g !== rel) {
      if (rel == null && burstStart.has(key)) cur = burstStart.get(key); // undo the jumps made before we knew
      rel = g;
      setMidiMode(msg.src, g, { auto: true, record: false });
      toast(`${srcLabel(msg.src)} is an endless knob. Turning the wrong way? MIDI panel → its button → ${g === 'lo' ? 'ENDLESS REV' : 'ENDLESS'}`);
    }
  }
  let next;
  if (msg.kind === 'note') {
    if (!pressed || (!p.options && p.kind !== 'toggle')) return;
    if (p.kind === 'toggle') next = !cur;
    else {
      const vals = p.options.map((o) => (typeof o === 'object' ? o.v : o));
      next = vals[(vals.indexOf(cur) + 1) % vals.length];
    }
  } else if (msg.kind === 'cc' && rel && rel !== 'abs') {
    const d = relDelta(msg.src, rel, msg.raw);
    if (!d) return;
    if (p.kind === 'toggle') next = d > 0;
    else if (p.options) {
      const vals = p.options.map((o) => (typeof o === 'object' ? o.v : o));
      next = vals[Math.max(0, Math.min(vals.length - 1, vals.indexOf(cur) + Math.sign(d)))];
    } else {
      // one click = one step of a stepped knob, or 1/128 of the travel
      const unit = p.step ? p.step / (p.max - p.min) : 1 / 128;
      next = fromNorm(p, toNorm(p, cur) + d * unit);
    }
  } else if (p.kind === 'toggle') {
    next = v >= 0.5;
  } else {
    next = fromNorm(p, v);
  }
  logLine(`             ${key}: ${JSON.stringify(cur)} -> ${JSON.stringify(next)}${msg.kind === 'cc' && rel && rel !== 'abs' ? `  (click ${relDelta.last})` : ''}`);
  pending.set(key, { m, k, v: next });
  raf ||= requestAnimationFrame(flush);
}

// Diagnostic log for the panel's COPY LOG: raw bytes, port, and what we did.
const debugLog = [];
const t0 = performance.now();
function logLine(text) {
  debugLog.push(text);
  if (debugLog.length > 300) debugLog.shift();
}

const noteOnAt = new Map(); // src -> time of its last real key-down (velocity > 0)
onMidiDropped((msg) => logLine(`${Math.round((msg.t ?? performance.now()) - t0).toString().padStart(7)}ms  [${msg.port}]  ${msg.bytes?.join(' ')}  ${srcLabel(msg.src)}  (copy from a 2nd port, ignored)`));

onMidi((msg) => {
  lastMsg = msg;
  if (msg.kind === 'note' && msg.on) noteOnAt.set(msg.src, performance.now());
  const map0 = getPatch().midiMap?.find((x) => x.src === msg.src);
  logLine(`${Math.round((msg.t ?? performance.now()) - t0).toString().padStart(7)}ms  [${msg.port}]  ${msg.bytes?.join(' ')}  ${srcLabel(msg.src)}${map0 ? `  -> ${map0.m}.${map0.k} mode=${map0.rel ?? 'unset'}${map0.auto ? '(guessed)' : ''}` : ''}${learning ? '  (learning)' : ''}`);
  if (msg.kind === 'cc') rawHistory.set(msg.src, [...(rawHistory.get(msg.src) ?? []).slice(-15), msg.raw]);
  activity();
  if (learning) return learn(msg);
  const map = getPatch().midiMap?.find((x) => x.src === msg.src);
  if (map) return apply(map, msg);
  if (msg.kind === 'note' && noteEntry.id) entryNote(msg);
});

// ---------------- NOTE ENTRY ----------------
export function armNoteEntry(id) {
  noteEntry.id = noteEntry.id === id ? null : id;
  noteEntry.cursor = 0;
  held.clear();
  chordBuf = [];
  if (noteEntry.id) {
    if (!midiState().enabled) enableMidi();
    const mod = findModule(id);
    toast(mod.type === 'melody'
      ? 'NOTE ENTRY: play keys to write the steps, one key per step'
      : 'NOTE ENTRY: play a chord (or one key) per slot');
  }
  refresh();
}

export function setCursor(i) {
  noteEntry.cursor = i;
}

const entryModule = () => {
  const mod = noteEntry.id && findModule(noteEntry.id);
  if (!mod) noteEntry.id = null;
  return mod || null;
};

function moveCursor(by) {
  const mod = entryModule();
  if (!mod) return;
  const len = mod.params.length;
  noteEntry.cursor = (((noteEntry.cursor + by) % len) + len) % len;
}

function entryRest() {
  const mod = entryModule();
  if (!mod) return;
  if (mod.type === 'melody') {
    const g = [...mod.params.gates];
    for (let j = g.length; j < noteEntry.cursor; j++) g[j] = 0;
    g[noteEntry.cursor] = 0;
    setParam(mod.id, 'gates', g);
  }
  moveCursor(1);
}

// Hear what was played through the VOICE the module feeds (a triangle if none).
function preview(mod, jack, notes) {
  const c = getPatch().cables.find((x) => x.from.m === mod.id && x.from.j === jack && findModule(x.to.m)?.type === 'voice');
  const voice = c && findModule(c.to.m);
  const vp = voice?.params;
  const s = !vp ? 'triangle' : vp.mode === 'synth' ? vp.wave : vp.sound;
  const tune = vp?.tune ?? 0;
  for (const n of notes) engine.audition({ s, note: n + tune, gain: 0.6 }).catch(() => {});
}

// The MELODY degree nearest a key. Keys outside the module's two octaves fold in
// by octaves; keys between scale notes snap to the nearest one (lower on a tie).
function melodyDegree(note, p) {
  const steps = scaleSteps(p.scale);
  const n = steps.length;
  const semi = (d) => steps[d % n] + 12 * Math.floor(d / n);
  let rel = note - (12 * (p.octave + 1) + ROOTS.indexOf(p.root));
  while (rel < 0) rel += 12;
  while (rel > semi(MELODY_MAX)) rel -= 12;
  let best = 0;
  for (let d = 1; d <= MELODY_MAX; d++) if (Math.abs(semi(d) - rel) < Math.abs(semi(best) - rel)) best = d;
  return { d: best, exact: semi(best) === rel };
}

const pcSet = (notes) => [...new Set(notes.map((x) => ((x % 12) + 12) % 12))].sort((a, b) => a - b).join(',');

// Name a played chord: try each key as the root (so inversions work) against the
// fixed chord types. Returns the root's pitch class and the type, or the lowest
// key with no type when nothing matches.
function detectChord(notes) {
  const sorted = [...notes].sort((a, b) => a - b);
  for (const root of sorted) {
    const iv = pcSet(sorted.map((x) => x - root));
    const q = CHORD_QUALITIES.find((o) => o.s && pcSet(o.s) === iv);
    if (q) return { pc: root % 12, qual: q.v };
  }
  return { pc: sorted[0] % 12, qual: null };
}

function writeChord(mod, notes) {
  const p = mod.params;
  const key = ROOTS.indexOf(p.root);
  const steps = scaleSteps(p.scale);
  const { pc, qual } = detectChord(notes);
  const rel = (pc - key + 12) % 12;
  let d = steps.indexOf(rel);
  const inKey = d >= 0;
  if (!inKey) d = steps.reduce((b, s, i) => (Math.abs(s - rel) < Math.abs(steps[b] - rel) ? i : b), 0);
  d = Math.min(d, 6);
  // AUTO when the key would build this exact chord anyway, so ADVANCED stays tidy
  let q = 'auto';
  if (qual && notes.length > 1) {
    const auto = chordPlan({ ...p, degrees: [d], quals: ['auto'], length: 1, lead: false, inv: 0, voicing: 'close' })[0].close;
    const want = CHORD_QUALITIES.find((o) => o.v === qual).s;
    if (pcSet(auto) !== pcSet(want.map((x) => x + auto[0]))) q = qual;
  }
  const i = noteEntry.cursor;
  const degrees = [...p.degrees];
  const quals = [...p.quals];
  degrees[i] = d;
  quals[i] = q;
  checkpoint();
  setParam(mod.id, 'degrees', degrees, { record: false });
  setParam(mod.id, 'quals', quals, { record: false });
  const name = chordPlan({ ...findModule(mod.id).params, length: CHORD_SLOTS })[i].name;
  setReadout(`SLOT ${i + 1} ← ${name}${inKey ? '' : ' (root not in key, snapped)'} · ${(mod.label || mod.id).toUpperCase()}`);
  moveCursor(1);
}

const held = new Set();
let chordBuf = [];

function entryNote(msg) {
  const mod = entryModule();
  if (!mod || !ENTRY_TYPES.includes(mod.type)) return;
  if (mod.type === 'melody') {
    if (!msg.on) return;
    const p = mod.params;
    const { d, exact } = melodyDegree(msg.note, p);
    const i = noteEntry.cursor;
    const degrees = [...p.degrees];
    const gates = [...p.gates];
    for (let j = degrees.length; j < i; j++) degrees[j] = 0;
    for (let j = gates.length; j < i; j++) gates[j] = 0;
    degrees[i] = d;
    gates[i] = 1;
    checkpoint();
    setParam(mod.id, 'degrees', degrees, { record: false });
    setParam(mod.id, 'gates', gates, { record: false });
    preview(mod, 'pitch', [msg.note]);
    setReadout(`STEP ${i + 1} ← ${midiToNote(msg.note).toUpperCase()} = ${d}${exact ? '' : ' (not in scale, snapped)'} · ${(mod.label || mod.id).toUpperCase()}`);
    moveCursor(1);
    return;
  }
  // CHORDS: gather every key pressed until all are released, then write one slot
  if (msg.on) {
    held.add(msg.note);
    chordBuf.push(msg.note);
    preview(mod, 'chord', [msg.note]);
  } else {
    held.delete(msg.note);
    if (!held.size && chordBuf.length) {
      writeChord(mod, chordBuf);
      chordBuf = [];
    }
  }
}

// ---------------- rack hooks ----------------
// Right-click menu items for the control under the pointer and the module.
export function midiMenuItems(id, target) {
  const items = [];
  const ctl = target.closest?.('.ctl[data-param], .ctl.button[data-action]');
  const k = ctl && (ctl.dataset.param ?? ctl.dataset.action);
  if (k && isLearnable(id, k)) {
    const map = mapFor(id, k);
    const label = targetLabel(id, k).split(' · ').pop();
    items.push({ label: `MIDI learn: ${label}`, hint: map ? srcLabel(map.src) : '', action: () => startLearn(id, k) });
    if (map?.rel && map.rel !== 'abs') items.push({ label: 'Reverse knob direction', hint: 'MIDI', action: () => chooseMidiMode(map.src, family(map.rel) === 'lo' ? 'hi' : 'lo') });
    if (map) items.push({ label: `Forget MIDI: ${label}`, action: () => confirmForget(`Forget the MIDI ${srcLabel(map.src)} → ${targetLabel(id, k)} mapping?`, (x) => x.src === map.src) });
  }
  const mod = findModule(id);
  if (ENTRY_TYPES.includes(mod?.type)) {
    items.push({ label: 'MIDI note entry', active: noteEntry.id === id, hint: noteEntry.id === id ? 'ON' : '', action: () => armNoteEntry(id) });
  }
  return items.length ? [...items, '-'] : [];
}

// Badges: mapped controls get a dot, the module NOTE ENTRY writes into a frame.
export function markMidi(root = document) {
  const mapped = new Set((getPatch().midiMap ?? []).map((x) => `${x.m}.${x.k}`));
  for (const el of root.querySelectorAll('.module .ctl[data-param], .module .ctl.button[data-action]')) {
    const m = el.closest('.module').dataset.id;
    el.classList.toggle('midi-mapped', mapped.has(`${m}.${el.dataset.param ?? el.dataset.action}`));
    el.classList.toggle('midi-learning', !!learning && learning.m === m && learning.k === (el.dataset.param ?? el.dataset.action));
  }
  for (const el of root.querySelectorAll('.module')) el.classList.toggle('midi-rec', el.dataset.id === entryModule()?.id);
}
refreshers.add(() => markMidi());
// an open panel redraws when the patch changes (forget, undo, load...), but not on
// every knob move: those only touch params, never the mapping list
let lastMaps = '';
subscribe((kind) => {
  const now = JSON.stringify(getPatch().midiMap ?? []);
  if (kind === 'params' && now === lastMaps) return;
  lastMaps = now;
  refresh();
});

// ---------------- topbar button + panel ----------------
const btnLed = h('span', { class: 'led' });
export const midiButton = h('button', { class: 'tb midi-btn', title: 'MIDI controller: learn knobs, note entry', onclick: () => showMidiPanel() }, btnLed, 'MIDI');
const syncButton = () => {
  const s = midiState();
  btnLed.classList.toggle('on', s.enabled && s.devices.length > 0);
};
let actT = null;
function activity() {
  midiButton.classList.add('act');
  clearTimeout(actT);
  actT = setTimeout(() => midiButton.classList.remove('act'), 90);
}
onMidiState(() => {
  syncButton();
  refresh();
});
syncButton();
restoreMidi();

function msgLabel(msg) {
  if (!msg) return 'nothing yet — move something on your controller';
  if (msg.kind === 'note') return `${srcLabel(msg.src)} ${msg.on ? `down · velocity ${Math.round(msg.vel * 127)}` : 'up'}`;
  const hist = msg.kind === 'cc' ? (rawHistory.get(msg.src) ?? []) : [];
  return `${srcLabel(msg.src)} = ${Math.round(msg.value * 127)}${hist.length > 1 ? `   ·   last values: ${hist.join(' ')}` : ''}`;
}

// The monitor + COPY MIDI LOG are for diagnosing a controller: only with ?debug=1.
const DEBUG = new URLSearchParams(location.search).get('debug') === '1';

async function copyLog() {
  const text = [`Bonfire STACK MIDI log · ${navigator.userAgent}`, `devices: ${midiState().devices.join(', ')}`,
    `mappings: ${JSON.stringify(getPatch().midiMap)}`, `remembered direction: ${preferredRel()}`, `build: ${typeof __APP_VERSION__ === 'undefined' ? 'dev' : __APP_VERSION__}`, '', ...debugLog].join('\n');
  try {
    await navigator.clipboard.writeText(text);
    toast('MIDI log copied');
  } catch {
    modal(h('textarea', { class: 've-input', rows: 20, style: { width: '80vw' } }, text));
  }
}

export function showMidiPanel() {
  const body = h('div', { class: 'midi-panel help' });
  const monitor = h('code', { class: 'midi-monitor' });
  const render = () => {
    const s = midiState();
    const kids = [h('h2', {}, 'MIDI')];
    if (!s.supported || !s.secure) {
      kids.push(h('p', {}, !s.secure
        ? 'MIDI only works on a secure page: https:// or localhost.'
        : 'This browser has no Web MIDI. Use Chrome, Edge or Firefox on a computer or Android (Safari and iPhone / iPad browsers can’t do MIDI).'));
      return body.replaceChildren(...kids.filter(Boolean));
    }
    if (!s.enabled) {
      kids.push(
        h('p', {}, 'Plug in a MIDI keyboard or controller, then turn MIDI on. The browser asks for permission once.'),
        s.error ? h('p', { class: 'midi-err' }, s.error) : null,
        h('button', { class: 'btn accent', onclick: () => enableMidi() }, 'TURN ON MIDI'));
      return body.replaceChildren(...kids.filter(Boolean));
    }
    const maps = getPatch().midiMap ?? [];
    const mapRow = (x) => h('li', { class: 'midi-row' },
      h('span', { class: 'midi-src' }, srcLabel(x.src)), h('span', { class: 'midi-tgt' }, targetLabel(x.m, x.k)),
      x.src.startsWith('cc:') ? h('button', {
        class: 'btn midi-mode',
        title: 'How this knob is read: KNOB = has ends; ENDLESS = endless knob; ENDLESS REV = endless knob, other direction. Guessed automatically; click to change.',
        onclick: () => chooseMidiMode(x.src, REL_MODES[(REL_MODES.indexOf(x.rel && x.rel !== 'abs' ? family(x.rel) : 'abs') + 1) % REL_MODES.length]),
      }, `${x.rel && x.rel !== 'abs' ? REL_LABEL[family(x.rel)] : 'KNOB'}${x.rel == null ? ' ?' : ''}`) : null,
      h('button', { class: 'tb icon', title: 'Forget', onclick: () => confirmForget(`Forget the MIDI ${srcLabel(x.src)} → ${targetLabel(x.m, x.k)} mapping?`, (y) => y.src === x.src) }, '✕'));
    const globalRow = (k) => {
      const map = mapFor('@', k);
      const wait = learning?.m === '@' && learning.k === k;
      return h('li', { class: 'midi-row' },
        h('span', { class: 'midi-src' }, wait ? 'MOVE IT…' : map ? srcLabel(map.src) : '—'), h('span', { class: 'midi-tgt' }, GLOBALS[k]),
        h('button', { class: `btn ${wait ? 'accent' : ''}`, onclick: () => (wait ? cancelLearn() : startLearn('@', k)) }, wait ? 'CANCEL' : 'LEARN'),
        map ? h('button', { class: 'tb icon', title: 'Forget', onclick: () => confirmForget(`Forget the MIDI ${srcLabel(map.src)} → ${GLOBALS[k]} mapping?`, (y) => y.src === map.src) }, '✕') : null);
    };
    const entry = entryModule();
    kids.push(
      h('p', { class: 'midi-devices' }, s.devices.length ? `Connected: ${s.devices.join(', ')}` : 'No MIDI device found — plug one in (it shows up here by itself).'),
      DEBUG ? h('p', {}, 'Last message: ', monitor) : null,
      DEBUG ? h('p', {}, h('button', { class: 'btn', onclick: copyLog }, 'COPY MIDI LOG'), h('span', { class: 'fine' }, '  — the last 300 messages and what the app did with them, for bug reports')) : null,
      h('h3', {}, 'Knobs & buttons'),
      h('p', {}, 'Right-click any knob, fader, switch or button → MIDI learn, then move a control on your device. Or use LEARN MODE to map one after another. Mappings are saved in the patch.'),
      h('button', { class: 'btn accent', onclick: () => { dlg.close(); setLearnMode(true); } }, 'LEARN MODE'),
      maps.some((x) => x.m !== '@') ? h('ul', { class: 'midi-list' }, maps.filter((x) => x.m !== '@').map(mapRow)) : h('p', { class: 'fine' }, 'Nothing mapped yet.'),
      h('h3', {}, 'App buttons'),
      h('ul', { class: 'midi-list' }, Object.keys(GLOBALS).map(globalRow)),
      h('h3', {}, 'Note entry'),
      h('p', {}, entry
        ? `Writing into ${(entry.label || entry.id).toUpperCase()} — next ${entry.type === 'melody' ? 'step' : 'slot'}: ${noteEntry.cursor + 1}. ${entry.type === 'melody'
          ? 'One key per step; keys outside the scale snap to it.'
          : 'Hold a chord (or one key) and let go to write the slot.'}`
        : 'Right-click a MELODY or CHORDS module → MIDI note entry, then play keys to write its steps. Click a step’s number to jump there.'),
      entry ? h('button', { class: 'btn', onclick: () => armNoteEntry(entry.id) }, 'STOP NOTE ENTRY') : null,
      h('h3', {}, 'Presets'),
      h('p', {}, 'Ready-made layouts for known controllers. They map what this patch has (the MIXER that feeds OUTPUT gets the mixer controls) and skip the rest.'),
      h('ul', { class: 'midi-list' }, PRESETS.map((pr) => h('li', { class: 'midi-row' },
        h('span', { class: 'midi-tgt' }, pr.name, s.devices.some((d) => presetFor(d) === pr) ? h('span', { class: 'fine' }, '  · connected') : null),
        h('button', { class: 'btn', onclick: () => loadPreset(pr) }, 'LOAD')))),
      h('h3', {}, 'Controller profile'),
      h('p', {}, 'Save your mappings as a file and load them into any patch, so you don’t map the controller again. Each one lands on the same kind of module (a FILTER knob on that patch’s FILTER); ones this patch has no module for are skipped.'),
      h('p', {}, h('button', { class: 'btn', onclick: exportProfile }, 'EXPORT'), ' ', h('button', { class: 'btn', onclick: importProfile }, 'IMPORT')),
      maps.length ? h('p', {}, h('button', { class: 'btn danger', onclick: () => confirmForget(`Forget all ${maps.length} MIDI mapping${maps.length === 1 ? '' : 's'} in this patch?`, () => true) }, 'FORGET ALL MAPPINGS'),
        ' ', h('button', { class: 'btn', onclick: () => disableMidi() }, 'TURN MIDI OFF'))
        : h('p', {}, h('button', { class: 'btn', onclick: () => disableMidi() }, 'TURN MIDI OFF')));
    body.replaceChildren(...kids.filter(Boolean));
    monitor.textContent = msgLabel(lastMsg);
  };
  const onMsg = () => (monitor.textContent = msgLabel(lastMsg));
  refreshers.add(render);
  const off = onMidi(() => setTimeout(onMsg));
  const dlg = modal(body, { className: 'modal-help', onClose: () => { refreshers.delete(render); off(); if (learning?.m === '@') cancelLearn(); } });
  render();
}

export const refreshMidi = refresh;
