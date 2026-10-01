// Sample library: groups every registered sound for the SAMPLES drawer, loads
// user packs (github:/shabda:/URL — these become samples('...') lines in the
// code) and keeps local drag-and-drop files in IndexedDB.
import { samples } from '@strudel/webaudio';
import { listSounds } from './engine.js';

const listeners = new Set();
export const onLibrary = (fn) => (listeners.add(fn), () => listeners.delete(fn));
const emit = () => listeners.forEach((fn) => fn());

const packSounds = new Map(); // pack url -> [sound names]
const packStatus = new Map(); // pack url -> 'loading' | 'ok' | error message
let localNames = [];

const SOURCES = [
  [/\/uzu-drumkit\//, 'Drum Kit'],
  [/tidal-drum-machines/, 'Drum Machines'],
  [/\/piano\//, 'Piano'],
  [/\/VCSL\//, 'Instruments (VCSL)'],
  [/\/mrid\//, 'Mridangam'],
  [/uzu-wavetables/, 'Wavetables'],
  [/Dirt-Samples/, 'Dirt Samples'],
];

export const GROUP_ORDER = ['Drum Kit', 'Drum Machines', 'Instruments (VCSL)', 'Piano', 'Soundfonts (GM)', 'Synths',
  'Dirt Samples', 'Mridangam', 'Wavetables'];

function variants(data) {
  const s = data?.samples;
  if (Array.isArray(s)) return s.length;
  if (s && typeof s === 'object') return Object.keys(s).length;
  return 1;
}

// { groupName: [{ name, variants, bank? }] }
export function library() {
  const all = listSounds();
  const groups = {};
  const owned = new Map();
  for (const [url, names] of packSounds) for (const n of names) owned.set(n, `Pack · ${url}`);
  for (const n of localNames) owned.set(n, 'Local files');
  for (const [name, entry] of Object.entries(all)) {
    const data = entry.data ?? {};
    let group = owned.get(name);
    if (!group) {
      if (data.type === 'soundfont' || name.startsWith('gm_')) group = 'Soundfonts (GM)';
      else if (data.type === 'synth' || data.type === 'zzfx' || !data.baseUrl) group = 'Synths';
      else group = SOURCES.find(([re]) => re.test(data.baseUrl))?.[1] ?? 'Other';
    }
    (groups[group] ??= []).push({ name, variants: variants(data) });
  }
  for (const list of Object.values(groups)) list.sort((a, b) => a.name.localeCompare(b.name));
  return groups;
}

export const packState = () => [...packStatus.entries()];

export async function loadPack(url) {
  if (packStatus.get(url) === 'ok' || packStatus.get(url) === 'loading') return;
  packStatus.set(url, 'loading');
  emit();
  const before = new Set(Object.keys(listSounds()));
  try {
    await samples(url);
    packSounds.set(url, Object.keys(listSounds()).filter((k) => !before.has(k)));
    packStatus.set(url, 'ok');
  } catch (e) {
    packStatus.set(url, e.message || 'failed to load');
  }
  emit();
}

export function forgetPack(url) {
  packSounds.delete(url);
  packStatus.delete(url);
  emit();
}

// ---------------- local files (IndexedDB) ----------------
const DB = 'bonfire-samples';
function db() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('files', { keyPath: 'id', autoIncrement: true });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
const tx = async (mode, fn) => {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction('files', mode);
    const out = fn(t.objectStore('files'));
    t.oncomplete = () => resolve(out?.result ?? out);
    t.onerror = () => reject(t.error);
  });
};

// "Kick 01.wav" -> "kick" ; "snare-hard_3.wav" -> "snare_hard"
export const soundNameFor = (fname) => fname.replace(/\.[^.]+$/, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '_').replace(/[_\d]+$/, '').replace(/^_+/, '') || 'sample';

async function registerLocal() {
  let rows = [];
  try {
    rows = await tx('readonly', (s) => s.getAll());
  } catch {
    return;
  }
  const map = {};
  for (const r of rows.sort((a, b) => a.fname.localeCompare(b.fname))) {
    (map[r.name] ??= []).push(URL.createObjectURL(r.blob));
  }
  if (Object.keys(map).length) await samples(map, '');
  localNames = Object.keys(map);
  emit();
}

export async function addLocalFiles(files) {
  const audio = [...files].filter((f) => f.type.startsWith('audio/') || /\.(wav|mp3|ogg|flac|m4a|aiff?)$/i.test(f.name));
  await tx('readwrite', (s) => audio.forEach((f) => s.add({ name: soundNameFor(f.name), fname: f.name, blob: f })));
  await registerLocal();
  return audio.length;
}

export async function removeLocalSound(name) {
  await tx('readwrite', (s) => {
    const req = s.openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return;
      if (c.value.name === name) c.delete();
      c.continue();
    };
  });
  localNames = localNames.filter((n) => n !== name);
  emit();
}

export const getLocalNames = () => localNames;
export const initLocal = registerLocal;
