// Patch state + undo history. Everything that changes the rack goes through here.
//   kind 'params'    – a control value moved (no DOM rebuild needed)
//   kind 'structure' – modules / cables added, removed or moved
//   kind 'reset'     – whole patch replaced (undo, load, demo)
import { MODULES, defaultParams } from '../modules/index.js';

export const HP_PX = 15;
export const ROW_HP = 96;

const CABLE_COLORS = ['#2ec4d6', '#e8483b', '#f2c230', '#5bc864', '#f28c28', '#b06ce0'];

export function emptyPatch() {
  return {
    format: 'bonfire-stack',
    version: 1,
    name: 'Untitled',
    modules: [{ id: 'output1', type: 'output', row: 0, x: 40, params: defaultParams('output') }],
    cables: [],
    samplePacks: [],
    localSounds: [],
  };
}

const listeners = new Set();
let patch = emptyPatch();
let undo = [];
let redo = [];
let cableColorIx = 0;
let palette = CABLE_COLORS;

export const getPatch = () => patch;
export const subscribe = (fn) => (listeners.add(fn), () => listeners.delete(fn));
const emit = (kind, detail) => listeners.forEach((fn) => fn(kind, detail));

export function setCablePalette(colors) {
  if (colors?.length) palette = colors;
}

// Snapshot before a change so it can be undone. Knob drags checkpoint once on
// pointerdown, then stream values with record:false.
export function checkpoint() {
  undo.push(JSON.stringify(patch));
  if (undo.length > 150) undo.shift();
  redo = [];
}

export function undoChange() {
  if (!undo.length) return;
  redo.push(JSON.stringify(patch));
  patch = JSON.parse(undo.pop());
  emit('reset');
}

export function redoChange() {
  if (!redo.length) return;
  undo.push(JSON.stringify(patch));
  patch = JSON.parse(redo.pop());
  emit('reset');
}

export function loadPatch(p, { record = true } = {}) {
  if (record) checkpoint();
  patch = normalize(p);
  emit('reset');
}

function normalize(p) {
  const out = { ...emptyPatch(), ...structuredClone(p) };
  out.modules = out.modules.filter((m) => MODULES[m.type]).map((m) => ({
    ...m,
    params: { ...defaultParams(m.type), ...m.params },
  }));
  const ids = new Set(out.modules.map((m) => m.id));
  out.cables = out.cables.filter((c) => ids.has(c.from.m) && ids.has(c.to.m));
  return out;
}

export const findModule = (id) => patch.modules.find((m) => m.id === id);

export function setParam(id, key, value, { record = true } = {}) {
  const m = findModule(id);
  if (!m) return;
  if (record) checkpoint();
  m.params[key] = value;
  emit('params', { id, key });
}

export function setName(name) {
  patch.name = name;
  emit('params', {});
}

function nextId(type) {
  let i = 1;
  while (patch.modules.some((m) => m.id === `${type}${i}`)) i++;
  return `${type}${i}`;
}

const overlaps = (a, b) => a.row === b.row && a.x < b.x + MODULES[b.type].hp && b.x < a.x + MODULES[a.type].hp;

export function fits(candidate, ignoreId) {
  if (candidate.x < 0 || candidate.row < 0) return false;
  return !patch.modules.some((m) => m.id !== ignoreId && overlaps(candidate, m));
}

// First free slot scanning rows top to bottom, left to right.
export function freeSlot(type, preferRow = 0) {
  const hp = MODULES[type].hp;
  for (let row = preferRow; row < preferRow + 20; row++) {
    for (let x = 0; x <= ROW_HP - hp; x++) if (fits({ type, row, x })) return { row, x };
  }
  return { row: rackRows(), x: 0 };
}

// Nearest free x in the row to the requested one (for drops onto occupied space).
export function nearestFree(type, row, x, ignoreId) {
  for (let d = 0; d < ROW_HP; d++) {
    for (const cx of [x - d, x + d]) if (cx >= 0 && fits({ type, row, x: cx }, ignoreId)) return cx;
  }
  return null;
}

export const rackRows = () => Math.max(3, ...patch.modules.map((m) => m.row + 2));
export const rackWidthHp = () => Math.max(ROW_HP, ...patch.modules.map((m) => m.x + MODULES[m.type].hp + 12));

export function addModule(type, at) {
  const def = MODULES[type];
  if (def.singleton && patch.modules.some((m) => m.type === type)) return { error: `Only one ${def.name} per rack.` };
  checkpoint();
  return { module: placeModule(type, at) };
}

// Several modules at once, as ONE undo step. Singletons already in the rack are skipped.
export function addModules(types) {
  const skipped = types.filter((t) => MODULES[t].singleton && patch.modules.some((m) => m.type === t));
  const ok = types.filter((t) => !skipped.includes(t));
  if (ok.length) checkpoint();
  return { added: ok.map((t) => placeModule(t)), skipped };
}

function placeModule(type, at) {
  let pos = at && fits({ type, ...at }) ? at : null;
  if (at && !pos) {
    const x = nearestFree(type, at.row, at.x);
    pos = x == null ? null : { row: at.row, x };
  }
  pos ??= freeSlot(type);
  const m = { id: nextId(type), type, ...pos, params: defaultParams(type) };
  patch.modules.push(m);
  emit('structure', { added: m.id });
  return m;
}

export function duplicateModule(id) {
  const src = findModule(id);
  if (!src) return {};
  const res = addModule(src.type, { row: src.row, x: src.x + MODULES[src.type].hp });
  if (res.module) {
    res.module.params = structuredClone(src.params);
    if (src.color) res.module.color = src.color; // a copy stays in its colour group
    emit('reset');
  }
  return res;
}

// Display name + panel colour. The id never changes: cables and the generated code use it.
export function setModuleLook(id, { label, color }) {
  const m = findModule(id);
  if (!m) return;
  checkpoint();
  if (label) m.label = label;
  else delete m.label;
  if (color) m.color = color;
  else delete m.color;
  emit('reset');
}

export function removeModule(id) {
  checkpoint();
  patch.modules = patch.modules.filter((m) => m.id !== id);
  patch.cables = patch.cables.filter((c) => c.from.m !== id && c.to.m !== id);
  emit('structure', { removed: id });
}

export function resetModule(id) {
  const m = findModule(id);
  if (!m) return;
  checkpoint();
  m.params = defaultParams(m.type);
  emit('reset');
}

export function moveModule(id, row, x) {
  const m = findModule(id);
  if (!m || (m.row === row && m.x === x)) return;
  checkpoint();
  Object.assign(m, { row, x });
  emit('structure', { moved: id });
}

export function nextCableColor() {
  const c = palette[cableColorIx % palette.length];
  cableColorIx++;
  return c;
}

// Inputs take one cable: connecting replaces whatever was there.
export function connect(from, to, color) {
  checkpoint();
  patch.cables = patch.cables.filter((c) => !(c.to.m === to.m && c.to.j === to.j));
  let i = 1;
  while (patch.cables.some((c) => c.id === `c${i}`)) i++;
  patch.cables.push({ id: `c${i}`, from, to, color: color ?? nextCableColor() });
  emit('structure', {});
}

export function disconnect(cableIds) {
  const ids = new Set([cableIds].flat());
  if (!patch.cables.some((c) => ids.has(c.id))) return;
  checkpoint();
  patch.cables = patch.cables.filter((c) => !ids.has(c.id));
  emit('structure', {});
}

export function addSamplePack(url) {
  if (patch.samplePacks.includes(url)) return;
  checkpoint();
  patch.samplePacks.push(url);
  emit('params', {});
}

export function removeSamplePack(url) {
  checkpoint();
  patch.samplePacks = patch.samplePacks.filter((u) => u !== url);
  emit('params', {});
}

export function setLocalSounds(names) {
  patch.localSounds = names;
  emit('params', {});
}
