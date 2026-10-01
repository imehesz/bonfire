// The rack: rows + rails, module placement/dragging, and the SVG cable layer.
import { MODULES, compatible } from '../modules/index.js';
import {
  HP_PX, addModule, connect, disconnect, duplicateModule, findModule, fits, getPatch, moveModule, nearestFree,
  rackRows, rackWidthHp, removeModule, resetModule,
} from '../core/store.js';
import { wouldCycle } from '../core/compile.js';
import { skinCableSag } from '../core/skins.js';
import { addLocalFiles } from '../core/samples.js';
import { buildModule } from './module.js';
import { h, menu, modal, s, toast } from './dom.js';

export const ROW_H = 380;
const settings = { zoom: 1, snap: 26, cableOpacity: 1 };
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
export const hoveredModule = () => hovered;

export function mountRack(host) {
  rowsLayer = h('div', { class: 'rows-layer' });
  modLayer = h('div', { class: 'modules-layer' });
  svg = s('svg', { class: 'cables-layer' });
  cableLayer = s('g');
  dragLayer = s('g');
  svg.append(cableLayer, dragLayer);
  inner = h('div', { class: 'rack-inner' }, rowsLayer, modLayer, svg);
  sizer = h('div', { class: 'rack-sizer' }, inner);
  scroller = h('div', { class: 'rack-scroll' }, sizer);
  host.append(scroller);

  modLayer.addEventListener('pointerdown', onPointerDown);
  modLayer.addEventListener('contextmenu', onContext);
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
      const res = addModule(type, { row: Math.max(0, Math.floor(p.y / ROW_H)), x: Math.max(0, Math.round(p.x / HP_PX - MODULES[type].hp / 2)) });
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
  const hgt = rows * ROW_H;
  inner.style.width = `${w}px`;
  inner.style.height = `${hgt}px`;
  inner.style.transform = `scale(${settings.zoom})`;
  sizer.style.width = `${w * settings.zoom}px`;
  sizer.style.height = `${hgt * settings.zoom}px`;
  svg.setAttribute('width', w);
  svg.setAttribute('height', hgt);
  if (rowsLayer.children.length !== rows) {
    rowsLayer.replaceChildren(...Array.from({ length: rows }, (_, i) => h('div', { class: 'rack-row', style: { top: `${i * ROW_H}px` } },
      h('div', { class: 'rail top' }), h('div', { class: 'rail bottom' }))));
  }
  for (const [id, v] of views) {
    const m = findModule(id);
    if (!m) continue;
    v.el.style.left = `${m.x * HP_PX}px`;
    v.el.style.top = `${m.row * ROW_H}px`;
  }
  drawCables();
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
  document.addEventListener('dblclick', (e) => {
    const g = e.target.closest?.('.cable');
    if (g?.dataset.id) disconnect(g.dataset.id);
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
  if (e.target.closest('.ctl, button, input, canvas')) return;
  const modEl = e.target.closest('.module');
  if (modEl) startModuleDrag(e, modEl);
}

function startCableDrag(e, start) {
  e.preventDefault();
  const patch = getPatch();
  let anchor = start; // the fixed end
  let fixedColor = null;
  let hideId = null;
  // grabbing a patched input picks up its cable by the input end
  if (start.dir === 'in') {
    const existing = patch.cables.find((c) => c.to.m === start.m && c.to.j === start.j);
    if (existing) {
      hideId = existing.id;
      fixedColor = existing.color;
      const out = MODULES[findModule(existing.from.m).type].outputs[existing.from.j];
      anchor = { m: existing.from.m, j: existing.from.j, dir: 'out', type: out.type };
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
  const move = (ev) => {
    let best = null;
    let bestD = settings.snap;
    for (const v of valid) {
      const r = v.el.querySelector('.jack-socket').getBoundingClientRect();
      const d = Math.hypot(ev.clientX - (r.left + r.width / 2), ev.clientY - (r.top + r.height / 2));
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
    const b = target ? jackCenter(target.m, wantDir, target.j) : toLocal(ev.clientX, ev.clientY);
    dragLayer.replaceChildren(cableEl(a, b, fixedColor ?? 'var(--accent)'));
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    document.body.classList.remove('cabling');
    dragLayer.replaceChildren();
    modLayer.querySelectorAll('.can-drop, .no-drop, .hot').forEach((el) => el.classList.remove('can-drop', 'no-drop', 'hot'));
    if (target) {
      const from = wantDir === 'in' ? { m: anchor.m, j: anchor.j } : { m: target.m, j: target.j };
      const to = wantDir === 'in' ? { m: target.m, j: target.j } : { m: anchor.m, j: anchor.j };
      if (hideId && to.m === start.m && to.j === start.j) {
        drawCables(); // dropped back where it was
      } else {
        if (hideId) disconnect(hideId);
        connect(from, to, fixedColor ?? undefined);
      }
    } else if (hideId) {
      disconnect(hideId); // dragged off into space = unplug
    } else {
      drawCables();
    }
  };
  move(e);
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

function startModuleDrag(e, modEl) {
  const id = modEl.dataset.id;
  const m = findModule(id);
  const def = MODULES[m.type];
  const p0 = toLocal(e.clientX, e.clientY);
  const offX = p0.x - m.x * HP_PX;
  const offY = p0.y - m.row * ROW_H;
  let moved = false;
  let pos = { row: m.row, x: m.x };
  modEl.setPointerCapture(e.pointerId);
  const move = (ev) => {
    const p = toLocal(ev.clientX, ev.clientY);
    if (!moved && Math.hypot(p.x - p0.x, p.y - p0.y) < 4) return;
    moved = true;
    modEl.classList.add('dragging');
    const row = Math.max(0, Math.round((p.y - offY) / ROW_H));
    const x = Math.max(0, Math.round((p.x - offX) / HP_PX));
    pos = { row, x };
    modEl.style.left = `${x * HP_PX}px`;
    modEl.style.top = `${row * ROW_H}px`;
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
    { label: `About ${def.name}`, action: () => showModuleHelp(def) },
    '-',
    { label: 'Duplicate', hint: 'Ctrl+D', action: () => { const r = duplicateModule(id); if (r.error) toast(r.error, 'warn'); } },
    { label: 'Reset knobs', action: () => resetModule(id) },
    { label: 'Unplug all cables', action: () => disconnect(getPatch().cables.filter((c) => c.from.m === id || c.to.m === id).map((c) => c.id)) },
    '-',
    { label: 'Delete', hint: 'Del', action: () => removeModule(id) },
  ]);
  anchor.remove();
}

export function showModuleHelp(def) {
  const jackList = (o, dir) => Object.values(o).map((j) => h('li', {}, h('span', { class: `jt jt-${j.type}` }), `${j.label} — ${dir} (${j.type})`));
  modal(h('div', { class: 'help' },
    h('h2', {}, def.name, h('small', {}, ` ${def.title} · ${def.hp} HP`)),
    h('p', {}, def.description),
    h('ul', { class: 'jack-help' }, jackList(def.inputs, 'input'), jackList(def.outputs, 'output'))), { className: 'modal-help' });
}
