// Phone arrangement: the patch's modules grouped into tracks of at most MAX_PER_TRACK.
// Stored in patch.mobile.tracks; a patch without one (desktop-made, demos) gets one
// derived from the desktop rack, row by row, left to right.
import { MODULES } from '../modules/index.js';
import { getPatch, setMobileTracks } from '../core/store.js';

export const MAX_PER_TRACK = 3;
const AUTO_HP = 28; // auto-packing stops filling a track past this width (~420px)

const hpOf = (id) => MODULES[getPatch().modules.find((m) => m.id === id)?.type]?.hp ?? 0;
const trackHp = (t) => t.reduce((a, id) => a + hpOf(id), 0);
const fitsAuto = (t, id) => t.length < MAX_PER_TRACK && trackHp(t) + hpOf(id) <= AUTO_HP;

function derive(modules) {
  const tracks = [];
  let row = null;
  for (const m of [...modules].sort((a, b) => a.row - b.row || a.x - b.x)) {
    const last = tracks.at(-1);
    if (last && m.row === row && fitsAuto(last, m.id)) last.push(m.id);
    else tracks.push([m.id]);
    row = m.row;
  }
  return tracks;
}

// The current tracks with deleted modules dropped and new ones appended. Writes the
// result back into the patch silently (no undo step, no event): it's bookkeeping.
export function tracks() {
  const patch = getPatch();
  const ids = new Set(patch.modules.map((m) => m.id));
  const saved = patch.mobile?.tracks;
  let out;
  if (!Array.isArray(saved)) out = derive(patch.modules);
  else {
    const seen = new Set();
    out = saved.map((t) => t.filter((id) => ids.has(id) && !seen.has(id) && seen.add(id)).slice(0, MAX_PER_TRACK)).filter((t) => t.length);
    const placed = new Set(out.flat());
    for (const m of patch.modules) {
      if (placed.has(m.id)) continue;
      const last = out.at(-1);
      if (last && fitsAuto(last, m.id)) last.push(m.id);
      else out.push([m.id]);
    }
  }
  patch.mobile = { ...(patch.mobile ?? {}), tracks: out };
  return out;
}

const copy = () => tracks().map((t) => [...t]);
const where = (ts, id) => {
  const ti = ts.findIndex((t) => t.includes(id));
  return { ti, i: ti < 0 ? -1 : ts[ti].indexOf(id) };
};
const commit = (ts, opts) => setMobileTracks(ts.filter((t) => t.length), opts);

export function canMove(id, dir) {
  const ts = tracks();
  const { ti, i } = where(ts, id);
  if (ti < 0) return false;
  if (dir === 'left') return i > 0;
  if (dir === 'right') return i < ts[ti].length - 1;
  if (dir === 'up') return ti > 0 && ts[ti - 1].length < MAX_PER_TRACK;
  if (dir === 'down') return ti < ts.length - 1 && ts[ti + 1].length < MAX_PER_TRACK;
  if (dir === 'alone') return ts[ti].length > 1;
  return false;
}

// left/right = swap within the track; up/down = append to the neighbouring track;
// alone = its own new track right below.
export function move(id, dir) {
  if (!canMove(id, dir)) return;
  const ts = copy();
  const { ti, i } = where(ts, id);
  const t = ts[ti];
  if (dir === 'left' || dir === 'right') {
    const j = dir === 'left' ? i - 1 : i + 1;
    [t[i], t[j]] = [t[j], t[i]];
  } else {
    t.splice(i, 1);
    if (dir === 'up') ts[ti - 1].push(id);
    else if (dir === 'down') ts[ti + 1].unshift(id);
    else ts.splice(ti + 1, 0, [id]);
  }
  commit(ts);
}

// straight into track `ti` (appended), if it has room
export function moveTo(id, ti) {
  const ts = copy();
  const { ti: from, i } = where(ts, id);
  if (from < 0 || from === ti || !ts[ti] || ts[ti].length >= MAX_PER_TRACK) return;
  ts[from].splice(i, 1);
  ts[ti].push(id);
  commit(ts);
}

export function moveTrack(ti, d) {
  const ts = copy();
  const j = ti + d;
  if (j < 0 || j >= ts.length) return;
  [ts[ti], ts[j]] = [ts[j], ts[ti]];
  commit(ts);
}

// Put a freshly added module into track `ti` (after `afterId`, if given), or into a
// new track at the end when ti is null or that track is full. Folded into the add's
// undo step (record:false).
export function place(id, ti, afterId = null) {
  const ts = copy().map((t) => t.filter((x) => x !== id));
  if (ti != null && ts[ti] && ts[ti].length < MAX_PER_TRACK) {
    const at = afterId ? ts[ti].indexOf(afterId) + 1 : ts[ti].length;
    ts[ti].splice(at || ts[ti].length, 0, id);
  } else ts.push([id]);
  commit(ts, { record: false });
}
