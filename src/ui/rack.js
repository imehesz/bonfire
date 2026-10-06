// The rack: rows + rails, module placement/dragging, and the SVG cable layer.
import { MODULES, compatible, defaultParams } from '../modules/index.js';
import {
  HP_PX, addModule, connect, disconnect, duplicateModule, findModule, fits, getPatch, moveModule, nearestFree,
  rackRows, rackWidthHp, removeModule, resetModule, setModuleLook,
} from '../core/store.js';
import { wouldCycle } from '../core/compile.js';
import { skinCableSag } from '../core/skins.js';
import { addLocalFiles } from '../core/samples.js';
import { buildModule, paintPanel } from './module.js';
import { h, menu, modal, s, toast } from './dom.js';

export const ROW_H = 380;
const COLLAPSED_H = 118; // head + one jack row + foot
const settings = { zoom: 1, snap: 26, cableOpacity: 1, hideCables: false, collapsedRows: [] };
try {
  Object.assign(settings, JSON.parse(localStorage.getItem('bonfire.rack') ?? '{}'));
} catch { /* ignore */ }
const saveSettings = () => {
  try {
    localStorage.setItem('bonfire.rack', JSON.stringify(settings));
  } catch { /* ignore */ }
};

const views = new Map();
let hovered = null;
let reachable = new Set();
let scroller;
let sizer;
let inner;
let rowsLayer;
let modLayer;
let svg;
let cableLayer;
let dragLayer;

export const rackSettings = settings;

// ---------------- row geometry (collapsed rows are short) ----------------
const isCollapsed = (i) => settings.collapsedRows.includes(i);
const rowH = (i) => (isCollapsed(i) ? COLLAPSED_H : ROW_H);
const rowTop = (i) => {
  let y = 0;
  for (let r = 0; r < i; r++) y += rowH(r);
  return y;
};
// the row whose band contains y (rows past the last one are full height)
function rowAt(y) {
  let top = 0;
  for (let r = 0; ; r++) {
    if (y < top + rowH(r)) return Math.max(0, r);
    top += rowH(r);
  }
}
// the row whose top is nearest y (module dragging snaps by top edge)
function nearestRow(y) {
  let best = 0;
  for (let r = 0, top = 0; r <= rackRows() + 1; top += rowH(r), r++) if (Math.abs(top - y) < Math.abs(rowTop(best) - y)) best = r;
  return best;
}

export function toggleRow(i) {
  settings.collapsedRows = isCollapsed(i) ? settings.collapsedRows.filter((r) => r !== i) : [...settings.collapsedRows, i];
  saveSettings();
  layout();
}
export const hoveredModule = () => hovered;

export function mountRack(host) {
  rowsLayer = h('div', { class: 'rows-layer' });
  modLayer = h('div', { class: 'modules-layer' });
  svg = s('svg', { class: 'cables-layer' });
  cableLayer = s('g', { class: 'cables-patched' });
  cableLayer.classList.toggle('hidden', settings.hideCables);
  dragLayer = s('g');
  svg.append(cableLayer, dragLayer);
  inner = h('div', { class: 'rack-inner' }, rowsLayer, modLayer, svg);
  sizer = h('div', { class: 'rack-sizer' }, inner);
  scroller = h('div', { class: 'rack-scroll' }, sizer);
  host.append(scroller);

  modLayer.addEventListener('pointerdown', onPointerDown);
  modLayer.addEventListener('contextmenu', onContext);
  // double-click on a module's bare panel (not a control) opens its help
  modLayer.addEventListener('dblclick', (e) => {
    if (e.target.closest('.jack-socket, .jack, .ctl, button, input, select, textarea, canvas, .editable, .step, .cell, [data-action]')) return;
    const modEl = e.target.closest('.module');
    if (!modEl) return;
    const m = findModule(modEl.dataset.id);
    if (m) showModuleHelp(MODULES[m.type], m);
  });
  modLayer.addEventListener('pointerover', (e) => {
    hovered = e.target.closest('.module')?.dataset.id ?? null;
  });
  modLayer.addEventListener('pointerleave', () => (hovered = null));
  scroller.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    setZoom(settings.zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08));
  }, { passive: false });

  // drops: modules from the browser, audio files from the desktop
  scroller.addEventListener('dragover', (e) => {
    if (e.dataTransfer.types.includes('text/bonfire-module') || e.dataTransfer.types.includes('Files')) e.preventDefault();
  });
  scroller.addEventListener('drop', async (e) => {
    const type = e.dataTransfer.getData('text/bonfire-module');
    if (type) {
      e.preventDefault();
      const p = toLocal(e.clientX, e.clientY);
      const res = addModule(type, { row: rowAt(Math.max(0, p.y)), x: Math.max(0, Math.round(p.x / HP_PX - MODULES[type].hp / 2)) });
      if (res.error) toast(res.error, 'warn');
      return;
    }
    if (e.dataTransfer.files.length) {
      e.preventDefault();
      const n = await addLocalFiles(e.dataTransfer.files);
      toast(n ? `Added ${n} sample file${n > 1 ? 's' : ''} — find them under SAMPLES › Local files` : 'No audio files in that drop', n ? '' : 'warn');
    }
  });
  rebuild();
  return { setZoom };
}

export function setZoom(z) {
  settings.zoom = Math.min(1.5, Math.max(0.45, Math.round(z * 100) / 100));
  saveSettings();
  layout();
  document.dispatchEvent(new CustomEvent('bonfire:zoom', { detail: settings.zoom }));
}

function toLocal(cx, cy) {
  const r = inner.getBoundingClientRect();
  return { x: (cx - r.left) / settings.zoom, y: (cy - r.top) / settings.zoom };
}

function layout() {
  const rows = rackRows();
  const w = rackWidthHp() * HP_PX;
  const hgt = rowTop(rows);
  inner.style.width = `${w}px`;
  inner.style.height = `${hgt}px`;
  inner.style.transform = `scale(${settings.zoom})`;
  sizer.style.width = `${w * settings.zoom}px`;
  sizer.style.height = `${hgt * settings.zoom}px`;
  svg.setAttribute('width', w);
  svg.setAttribute('height', hgt);
  rowsLayer.replaceChildren(...Array.from({ length: rows }, (_, i) => h('div', {
    class: `rack-row${isCollapsed(i) ? ' collapsed' : ''}`,
    style: { top: `${rowTop(i)}px`, height: `${rowH(i)}px` },
  },
  h('div', { class: 'rail top' }), h('div', { class: 'rail bottom' }),
  h('button', { class: 'row-toggle', title: isCollapsed(i) ? 'Expand this row' : 'Collapse this row (keeps the jacks)', onclick: () => toggleRow(i) }))));
  for (const [id, v] of views) {
    const m = findModule(id);
    if (!m) continue;
    placeModule(v.el, m.row, m.x);
  }
  drawCables();
}

function placeModule(el, row, x) {
  el.style.left = `${x * HP_PX}px`;
  el.style.top = `${rowTop(row)}px`;
  el.style.height = `${rowH(row)}px`;
  el.classList.toggle('collapsed', isCollapsed(row));
}

export function rebuild() {
  modLayer.replaceChildren();
  views.clear();
  sync();
}

export function sync() {
  const patch = getPatch();
  const ids = new Set(patch.modules.map((m) => m.id));
  for (const [id, v] of views) {
    if (!ids.has(id)) {
      v.el.remove();
      views.delete(id);
    }
  }
  for (const m of patch.modules) {
    if (views.has(m.id)) continue;
    const v = buildModule(m);
    views.set(m.id, v);
    modLayer.append(v.el);
  }
  markReachable(reachable);
  layout();
}

export function updateParam(id, key) {
  views.get(id)?.updateParam(key);
}

export function markReachable(set) {
  reachable = set;
  for (const [id, v] of views) v.el.classList.toggle('unpatched', !set.has(id));
}

export function tick(cycle, meta) {
  for (const [id, v] of views) v.tick(cycle, meta[id]);
}

// ---------------- cables ----------------
function jackCenter(m, dir, j) {
  const el = views.get(m)?.jacks[`${dir}:${j}`]?.querySelector('.jack-socket');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return toLocal(r.left + r.width / 2, r.top + r.height / 2);
}

function cablePath(a, b) {
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  const sag = Math.min(260, 24 + dist * 0.32) * skinCableSag();
  return `M${a.x},${a.y} C${a.x},${a.y + sag} ${b.x},${b.y + sag} ${b.x},${b.y}`;
}

function cableEl(a, b, color, id) {
  const d = cablePath(a, b);
  const g = s('g', { class: 'cable', 'data-id': id ?? '' });
  g.style.setProperty('--c', color);
  g.append(
    s('path', { d, class: 'c-shadow' }),
    s('path', { d, class: 'c-main' }),
    s('path', { d, class: 'c-hi' }),
    s('circle', { cx: a.x, cy: a.y, r: 7, class: 'plug' }),
    s('circle', { cx: b.x, cy: b.y, r: 7, class: 'plug' }),
  );
  return g;
}

// Hide every patched cable (the patch is untouched; a cable being dragged still shows).
export function setCablesHidden(on) {
  settings.hideCables = on;
  cableLayer?.classList.toggle('hidden', on);
  saveSettings();
}

export function drawCables(hideId) {
  if (!cableLayer) return;
  const els = [];
  for (const c of getPatch().cables) {
    if (c.id === hideId) continue;
    const a = jackCenter(c.from.m, 'out', c.from.j);
    const b = jackCenter(c.to.m, 'in', c.to.j);
    if (!a || !b) continue;
    els.push(cableEl(a, b, c.color, c.id));
  }
  cableLayer.replaceChildren(...els);
  svg.style.setProperty('--cable-user-opacity', settings.cableOpacity);
  for (const v of views.values()) {
    for (const [key, el] of Object.entries(v.jacks)) {
      const [dir, j] = key.split(':');
      const mid = el.dataset.m;
      el.classList.toggle('patched', getPatch().cables.some((c) => (dir === 'in' ? c.to.m === mid && c.to.j === j : c.from.m === mid && c.from.j === j)));
    }
  }
}

svgClick();
function svgClick() {
  // double-click picks the cable up by whichever end is nearer, still in hand: click a jack to replug, anywhere else to unplug
  document.addEventListener('dblclick', (e) => {
    const g = e.target.closest?.('.cable');
    const c = g?.dataset.id && getPatch().cables.find((x) => x.id === g.dataset.id);
    if (!c) return;
    const p = toLocal(e.clientX, e.clientY);
    const a = jackCenter(c.from.m, 'out', c.from.j);
    const b = jackCenter(c.to.m, 'in', c.to.j);
    const outNearer = a && b && Math.hypot(p.x - a.x, p.y - a.y) < Math.hypot(p.x - b.x, p.y - b.y);
    const end = outNearer ? { m: c.from.m, j: c.from.j, dir: 'out' } : { m: c.to.m, j: c.to.j, dir: 'in' };
    startCableDrag(e, end, c);
  });
  document.addEventListener('contextmenu', (e) => {
    const g = e.target.closest?.('.cable');
    if (g?.dataset.id) {
      e.preventDefault();
      disconnect(g.dataset.id);
    }
  });
}

function jackInfo(el) {
  const j = el.closest('.jack');
  return j ? { m: j.dataset.m, j: j.dataset.j, dir: j.dataset.dir, type: j.dataset.type, el: j } : null;
}

function onPointerDown(e) {
  if (e.button !== 0) return;
  const socket = e.target.closest('.jack-socket');
  if (socket) return startCableDrag(e, jackInfo(socket));
  if (e.target.closest('.ctl, button, input, canvas, .editable')) return;
  const modEl = e.target.closest('.module');
  if (modEl) startModuleDrag(e, modEl);
}

// `grabbed` = an existing cable picked up by its `start` end (already in hand, no drag needed)
function startCableDrag(e, start, grabbed = null) {
  e.preventDefault();
  const patch = getPatch();
  let anchor = start; // the fixed end
  let fixedColor = null;
  let hideId = null;
  // grabbing a patched input picks up its cable by the input end
  const existing = grabbed ?? (start.dir === 'in' ? patch.cables.find((c) => c.to.m === start.m && c.to.j === start.j) : null);
  if (existing) {
    hideId = existing.id;
    fixedColor = existing.color;
    if (start.dir === 'in') {
      const out = MODULES[findModule(existing.from.m).type].outputs[existing.from.j];
      anchor = { m: existing.from.m, j: existing.from.j, dir: 'out', type: out.type };
    } else {
      const inp = MODULES[findModule(existing.to.m).type].inputs[existing.to.j];
      anchor = { m: existing.to.m, j: existing.to.j, dir: 'in', type: inp.type };
    }
  }
  const wantDir = anchor.dir === 'out' ? 'in' : 'out';
  const valid = [];
  for (const el of modLayer.querySelectorAll(`.jack.${wantDir}`)) {
    const t = { m: el.dataset.m, j: el.dataset.j, type: el.dataset.type };
    const ok = wantDir === 'in'
      ? compatible(anchor.type, t.type) && !wouldCycle(patch, anchor.m, t.m)
      : compatible(t.type, anchor.type) && !wouldCycle(patch, t.m, anchor.m);
    el.classList.add(ok ? 'can-drop' : 'no-drop');
    if (ok) valid.push({ ...t, el });
  }
  document.body.classList.add('cabling');
  drawCables(hideId);
  const a = jackCenter(anchor.m, anchor.dir, anchor.j);
  let target = null;
  let last = { x: e.clientX, y: e.clientY };
  // follow the pointer; also re-run on scroll, since the rack slides under a still pointer
  const move = (ev) => {
    if (ev) last = { x: ev.clientX, y: ev.clientY };
    let best = null;
    let bestD = settings.snap;
    for (const v of valid) {
      const r = v.el.querySelector('.jack-socket').getBoundingClientRect();
      const d = Math.hypot(last.x - (r.left + r.width / 2), last.y - (r.top + r.height / 2));
      if (d < bestD) {
        bestD = d;
        best = v;
      }
    }
    if (target !== best) {
      target?.el.classList.remove('hot');
      best?.el.classList.add('hot');
      target = best;
    }
    const b = target ? jackCenter(target.m, wantDir, target.j) : toLocal(last.x, last.y);
    dragLayer.replaceChildren(cableEl(a, b, fixedColor ?? 'var(--accent)'));
  };
  const onScroll = () => move();
  const cleanup = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointerdown', stickyDown, true);
    window.removeEventListener('pointerup', stickyUp, true);
    window.removeEventListener('keydown', onKey);
    scroller.removeEventListener('scroll', onScroll);
    document.body.classList.remove('cabling');
    dragLayer.replaceChildren();
    modLayer.querySelectorAll('.can-drop, .no-drop, .hot').forEach((el) => el.classList.remove('can-drop', 'no-drop', 'hot'));
  };
  const finish = () => {
    cleanup();
    if (target) {
      const from = wantDir === 'in' ? { m: anchor.m, j: anchor.j } : { m: target.m, j: target.j };
      const to = wantDir === 'in' ? { m: target.m, j: target.j } : { m: anchor.m, j: anchor.j };
      if (hideId && target.m === start.m && target.j === start.j) {
        drawCables(); // dropped back where it was
      } else {
        if (hideId) disconnect(hideId);
        connect(from, to, fixedColor ?? undefined);
      }
    } else if (hideId) {
      disconnect(hideId); // dropped into space = unplug
    } else {
      drawCables();
    }
  };
  // a plain click (no drag) leaves the cable in hand: scroll anywhere, then click a jack to plug it in.
  // The next tap/click ends it; a touch that turns into a scroll never fires pointerup, so it doesn't.
  let downAt = null;
  const stickyDown = (ev) => {
    ev.stopPropagation(); // don't start another cable / module drag
    downAt = { x: ev.clientX, y: ev.clientY };
  };
  const stickyUp = (ev) => {
    if (!downAt || Math.hypot(ev.clientX - downAt.x, ev.clientY - downAt.y) > 8) return (downAt = null);
    ev.stopPropagation();
    move(ev);
    finish();
  };
  const onKey = (ev) => {
    if (ev.key !== 'Escape') return;
    cleanup();
    drawCables(); // cancel: a picked-up cable goes back where it was
  };
  const holdInHand = () => {
    window.addEventListener('pointerdown', stickyDown, true);
    window.addEventListener('pointerup', stickyUp, true);
    window.addEventListener('keydown', onKey);
    scroller.addEventListener('scroll', onScroll);
  };
  const up = (ev) => {
    window.removeEventListener('pointerup', up);
    if (Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 4) return holdInHand();
    finish();
  };
  move(e);
  window.addEventListener('pointermove', move);
  if (grabbed) holdInHand(); // the double-click's own pointerup has already happened
  else window.addEventListener('pointerup', up);
}

function startModuleDrag(e, modEl) {
  const id = modEl.dataset.id;
  const m = findModule(id);
  const def = MODULES[m.type];
  const p0 = toLocal(e.clientX, e.clientY);
  const offX = p0.x - m.x * HP_PX;
  const offY = p0.y - rowTop(m.row);
  let moved = false;
  let pos = { row: m.row, x: m.x };
  modEl.setPointerCapture(e.pointerId);
  const move = (ev) => {
    const p = toLocal(ev.clientX, ev.clientY);
    if (!moved && Math.hypot(p.x - p0.x, p.y - p0.y) < 4) return;
    moved = true;
    modEl.classList.add('dragging');
    const row = nearestRow(p.y - offY);
    const x = Math.max(0, Math.round((p.x - offX) / HP_PX));
    pos = { row, x };
    placeModule(modEl, row, x);
    modEl.classList.toggle('blocked', !fits({ type: m.type, row, x }, id));
    drawCables();
  };
  const up = (ev) => {
    modEl.releasePointerCapture(ev.pointerId);
    modEl.removeEventListener('pointermove', move);
    modEl.removeEventListener('pointerup', up);
    modEl.classList.remove('dragging', 'blocked');
    if (!moved) return;
    let { row, x } = pos;
    if (!fits({ type: m.type, row, x }, id)) {
      const nx = nearestFree(m.type, row, x, id);
      if (nx == null || Math.abs(nx - x) > def.hp * 2) ({ row, x } = m);
      else x = nx;
    }
    if (row === m.row && x === m.x) layout();
    else moveModule(id, row, x);
  };
  modEl.addEventListener('pointermove', move);
  modEl.addEventListener('pointerup', up);
}

function onContext(e) {
  const socket = e.target.closest('.jack-socket');
  if (socket) {
    e.preventDefault();
    const j = jackInfo(socket);
    const ids = getPatch().cables.filter((c) => (j.dir === 'in' ? c.to.m === j.m && c.to.j === j.j : c.from.m === j.m && c.from.j === j.j)).map((c) => c.id);
    disconnect(ids);
    return;
  }
  const modEl = e.target.closest('.module');
  if (!modEl || e.target.closest('.step, .cell')) return;
  e.preventDefault();
  const id = modEl.dataset.id;
  const def = MODULES[findModule(id).type];
  const anchor = h('div', { style: { position: 'fixed', left: `${e.clientX}px`, top: `${e.clientY}px`, width: '1px', height: '1px' } });
  document.body.append(anchor);
  menu(anchor, [
    { label: `About ${def.name}`, action: () => showModuleHelp(def, findModule(id)) },
    { label: 'Settings…', action: () => showModuleSettings(id) },
    '-',
    { label: 'Duplicate', hint: 'Ctrl+D', action: () => { const r = duplicateModule(id); if (r.error) toast(r.error, 'warn'); } },
    { label: 'Reset knobs', action: () => resetModule(id) },
    { label: 'Unplug all cables', action: () => disconnect(getPatch().cables.filter((c) => c.from.m === id || c.to.m === id).map((c) => c.id)) },
    '-',
    { label: 'Delete', hint: 'Del', action: () => removeModule(id) },
  ]);
  anchor.remove();
}

// ---------------- module settings: name + panel colour ----------------
const RECENT_KEY = 'bonfire.recentColors';
function recentColors() {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}
function rememberColor(c) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([c, ...recentColors().filter((x) => x !== c)].slice(0, 10)));
  } catch { /* ignore */ }
}

function showModuleSettings(id) {
  const m = findModule(id);
  const def = MODULES[m.type];
  const modEl = modLayer.querySelector(`.module[data-id="${id}"]`);
  let color = m.color ?? null;
  let saved = false;
  const name = h('input', { class: 'set-name', value: m.label ?? '', placeholder: m.id, maxlength: 24, spellcheck: 'false' });
  const picker = h('input', { type: 'color', class: 'set-picker', value: color ?? '#5a5048', title: 'Pick any colour' });
  const swatches = h('div', { class: 'set-swatches' });
  const pick = (c) => {
    color = c;
    if (c) picker.value = c;
    if (modEl) paintPanel(modEl, c); // live preview on the rack
    drawSwatches();
  };
  const drawSwatches = () => swatches.replaceChildren(
    h('button', { class: `swatch none ${color ? '' : 'on'}`, title: 'Skin default', onclick: () => pick(null) }),
    ...recentColors().map((c) => h('button', { class: `swatch ${c === color ? 'on' : ''}`, title: c, style: { background: c }, onclick: () => pick(c) })),
  );
  picker.addEventListener('input', () => pick(picker.value));
  drawSwatches();
  const save = () => {
    saved = true;
    if (color) rememberColor(color);
    dlg.close();
    setModuleLook(id, { label: name.value.trim(), color });
  };
  name.addEventListener('keydown', (e) => e.key === 'Enter' && save());
  const dlg = modal(h('div', { class: 'mod-settings' },
    h('h2', {}, def.name, h('small', {}, ` ${m.id}`)),
    h('label', { class: 'set-label' }, 'NAME', name),
    h('div', { class: 'set-label' }, 'COLOR', h('div', { class: 'set-colors' }, picker, swatches)),
    h('div', { class: 'confirm-actions' },
      h('button', { class: 'btn', onclick: () => dlg.close() }, 'CANCEL'),
      h('button', { class: 'btn accent', onclick: save }, 'SAVE'))), {
    className: 'modal-confirm',
    onClose: () => !saved && modEl && paintPanel(modEl, m.color), // cancelled: drop the preview
  });
  name.focus();
  name.select();
}

// The help dialog shows the real faceplate, built in the current skin: a fresh
// one from the module browser, or the module's own knob settings from the rack.
function modulePreview(def, mod) {
  const params = { ...defaultParams(def.type), ...structuredClone(mod?.params ?? {}) };
  const face = buildModule({ id: mod?.id ?? `${def.type}1`, type: def.type, params }, { preview: true }).el;
  face.inert = true;
  const w = def.hp * HP_PX;
  return h('div', { class: 'help-face', style: { '--face-w': `${w}px` } }, face);
}

export function showModuleHelp(def, mod = null) {
  const jackList = (o, dir) => Object.values(o).map((j) => h('li', {}, h('span', { class: `jt jt-${j.type}` }), `${j.label} — ${dir} (${j.type})`));
  modal(h('div', { class: 'help' },
    h('h2', {}, def.name, h('small', {}, ` ${def.title} · ${def.hp} HP`)),
    h('div', { class: 'help-mod' },
      modulePreview(def, mod),
      h('div', { class: 'help-text' },
        h('p', {}, def.description),
        h('ul', { class: 'jack-help' }, jackList(def.inputs, 'input'), jackList(def.outputs, 'output'))))), { className: 'modal-help modal-help-mod' });
}
