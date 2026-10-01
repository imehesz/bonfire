// Panel controls. Each factory returns { el, update(value) } and writes through
// the store: checkpoint() on grab, setParam(..., {record:false}) while dragging.
import { checkpoint, findModule, setParam } from '../core/store.js';
import { SOUND_CATEGORIES, prettySound } from '../core/music.js';
import { audition } from '../core/engine.js';
import { GROUP_ORDER, getLocalNames, library } from '../core/samples.js';
import { closePopover, h, hideTip, popover, showTip } from './dom.js';

const optValue = (o) => (typeof o === 'object' ? o.v : o);
const optLabel = (o) => (typeof o === 'object' ? o.l : String(o).toUpperCase());

export function formatValue(p, v) {
  if (p.options) {
    const o = p.options.find((x) => optValue(x) === v);
    return o ? optLabel(o) : String(v);
  }
  if (p.unit === 'Hz') return v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 1 : 2)} kHz` : `${Math.round(v)} Hz`;
  if (p.unit === 'dB') return `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`;
  if (p.unit === 'st') return `${v > 0 ? '+' : ''}${v} st`;
  if (p.unit === 's') return `${v.toFixed(2)} s`;
  if (p.unit === 'BPM') return `${Math.round(v)} BPM`;
  if (p.step === 1) return String(Math.round(v));
  return v.toFixed(2);
}

// value <-> 0..1 knob travel
function toNorm(p, v) {
  if (p.options) return p.options.length < 2 ? 0 : Math.max(0, p.options.findIndex((o) => optValue(o) === v)) / (p.options.length - 1);
  const t = p.curve === 'log' ? Math.log(v / p.min) / Math.log(p.max / p.min)
    : p.curve === 'pow' ? Math.sqrt((v - p.min) / (p.max - p.min)) : (v - p.min) / (p.max - p.min);
  return Math.min(1, Math.max(0, t));
}
function fromNorm(p, t) {
  t = Math.min(1, Math.max(0, t));
  if (p.options) return optValue(p.options[Math.round(t * (p.options.length - 1))]);
  let v = p.curve === 'log' ? p.min * (p.max / p.min) ** t : p.curve === 'pow' ? p.min + (p.max - p.min) * t * t : p.min + (p.max - p.min) * t;
  if (p.step) v = Math.round(v / p.step) * p.step;
  else v = Math.round(v * 1000) / 1000;
  return v;
}

// Double-click popup: type an exact value (or pick an option) instead of dragging.
export function editValue(anchor, p, current, commit) {
  if (p.options) {
    const list = h('div', { class: 'pick-list' }, p.options.map((o) => h('button', {
      class: `pick ${optValue(o) === current ? 'active' : ''}`,
      onclick: () => {
        commit(optValue(o));
        closePopover();
      },
    }, optLabel(o))));
    popover(anchor, h('div', { class: 'value-edit' }, h('div', { class: 've-title' }, p.label), list), { className: 'pop-select' });
    list.querySelector('.active')?.scrollIntoView({ block: 'center' });
    return;
  }
  const unit = p.unit ?? '';
  const input = h('input', {
    type: 'number', class: 've-input', value: String(current), min: p.min, max: p.max, step: p.step ?? 'any',
  });
  const apply = () => {
    let v = parseFloat(input.value);
    if (!Number.isFinite(v)) return;
    v = Math.min(p.max, Math.max(p.min, v));
    v = p.step ? Math.round(v / p.step) * p.step : Math.round(v * 1000) / 1000;
    commit(v);
    closePopover();
  };
  const form = h('form', { class: 'value-edit', onsubmit: (e) => { e.preventDefault(); apply(); } },
    h('div', { class: 've-title' }, p.label, h('span', {}, `${p.min} – ${p.max}${unit ? ` ${unit}` : ''}`)),
    h('div', { class: 've-row' }, input, unit ? h('span', { class: 've-unit' }, unit) : null),
    h('div', { class: 've-actions' },
      h('button', { type: 'button', class: 'btn', onclick: () => { commit(structuredClone(p.default)); closePopover(); } }, 'DEFAULT'),
      h('button', { type: 'submit', class: 'btn accent' }, 'SET')));
  input.addEventListener('keydown', (e) => e.key === 'Escape' && closePopover());
  popover(anchor, form, { className: 'pop-value' });
  setTimeout(() => {
    input.focus();
    input.select();
  }, 0);
}

// Vertical-drag behaviour shared by knobs and rotary switches.
function dragValue(el, mod, key, p, onTip) {
  let start = 0;
  let startY = 0;
  let acc = 0;
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    el.setPointerCapture(e.pointerId);
    checkpoint();
    start = toNorm(p, findModule(mod.id).params[key]);
    startY = e.clientY;
    acc = 0;
    el.classList.add('grabbed');
    onTip(e);
  });
  el.addEventListener('pointermove', (e) => {
    if (!el.hasPointerCapture(e.pointerId)) return;
    const dy = startY - e.clientY;
    const range = p.options ? Math.max(60, p.options.length * 14) : e.shiftKey ? 900 : 180;
    acc = dy / range;
    const v = fromNorm(p, start + acc);
    if (v !== findModule(mod.id).params[key]) setParam(mod.id, key, v, { record: false });
    onTip(e);
  });
  const end = (e) => {
    if (!el.hasPointerCapture?.(e.pointerId)) return;
    el.releasePointerCapture(e.pointerId);
    el.classList.remove('grabbed');
    hideTip();
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    hideTip();
    editValue(el, p, findModule(mod.id).params[key], (v) => setParam(mod.id, key, v));
  });
  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    const cur = findModule(mod.id).params[key];
    const stepN = p.options ? 1 / (p.options.length - 1) : p.step ? p.step / (p.max - p.min) : 0.01;
    const v = fromNorm(p, toNorm(p, cur) + (e.deltaY < 0 ? stepN : -stepN) * (p.options || p.step ? 1 : 2));
    if (v !== cur) setParam(mod.id, key, v);
    const r = el.getBoundingClientRect();
    showTip(`${p.label} ${formatValue(p, v)}`, r.left + r.width / 2, r.top - 6);
    clearTimeout(el._tipT);
    el._tipT = setTimeout(hideTip, 700);
  }, { passive: false });
}

export function knob(mod, key, p) {
  const size = p.size ?? 'md';
  const ptr = h('div', { class: 'knob-ptr' });
  const cap = h('div', { class: 'knob-cap' }, h('div', { class: 'knob-img' }), ptr);
  const val = p.options ? h('div', { class: 'knob-val' }) : null;
  const el = h('div', { class: `ctl knob knob-${size} ${p.options ? 'rotary' : ''}`, title: '' },
    h('div', { class: 'knob-scale' }, cap), val, h('label', {}, p.label));
  const update = (v) => {
    const t = toNorm(p, v);
    cap.style.setProperty('--rot', `${-135 + t * 270}deg`);
    if (val) val.textContent = formatValue(p, v);
  };
  dragValue(cap, mod, key, p, () => {
    const r = cap.getBoundingClientRect();
    showTip(`${p.label} ${formatValue(p, findModule(mod.id).params[key])}`, r.left + r.width / 2, r.top - 6);
  });
  return { el, update };
}

export function fader(mod, key, p) {
  const capEl = h('div', { class: 'fader-cap' });
  const marks = p.marks ? h('div', { class: 'fader-marks' }, p.marks.map((m) => h('span', { style: { bottom: `${toNorm(p, m) * 100}%` } }, m > 0 ? `+${m}` : m))) : null;
  const track = h('div', { class: 'fader-track' }, h('div', { class: 'fader-slot' }), capEl);
  const el = h('div', { class: 'ctl fader' }, h('div', { class: 'fader-body' }, track, marks), h('label', {}, p.label));
  const update = (v) => capEl.style.setProperty('--pos', toNorm(p, v));
  const set = (e) => {
    const r = track.getBoundingClientRect();
    const t = 1 - (e.clientY - r.top - 8) / (r.height - 16);
    const v = fromNorm(p, t);
    if (v !== findModule(mod.id).params[key]) setParam(mod.id, key, v, { record: false });
    showTip(`${p.label} ${formatValue(p, v)}`, r.left + r.width / 2, r.top - 6);
  };
  track.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    track.setPointerCapture(e.pointerId);
    checkpoint();
    set(e);
  });
  track.addEventListener('pointermove', (e) => track.hasPointerCapture(e.pointerId) && set(e));
  track.addEventListener('pointerup', (e) => {
    track.releasePointerCapture(e.pointerId);
    hideTip();
  });
  track.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    hideTip();
    editValue(capEl, p, findModule(mod.id).params[key], (v) => setParam(mod.id, key, v));
  });
  return { el, update };
}

export function switcher(mod, key, p) {
  const btns = p.options.map((o) => h('button', {
    class: 'sw-pos',
    onpointerdown: (e) => e.stopPropagation(),
    onclick: () => setParam(mod.id, key, optValue(o)),
  }, optLabel(o)));
  const el = h('div', { class: `ctl switch n${btns.length}` }, h('div', { class: 'sw-body' }, btns), h('label', {}, p.label));
  const update = (v) => btns.forEach((b, i) => b.classList.toggle('on', optValue(p.options[i]) === v));
  return { el, update };
}

export function toggle(mod, key, p) {
  const led = h('span', { class: 'led' });
  const btn = h('button', {
    class: 'tgl',
    onpointerdown: (e) => e.stopPropagation(),
    onclick: () => setParam(mod.id, key, !findModule(mod.id).params[key]),
  }, led);
  const el = h('div', { class: 'ctl toggle' }, btn, h('label', {}, p.label));
  const update = (v) => {
    led.classList.toggle('on', !!v);
    btn.classList.toggle('on', !!v);
  };
  return { el, update };
}

export function select(mod, key, p) {
  const disp = h('button', { class: 'lcd sel-disp', onpointerdown: (e) => e.stopPropagation() });
  const step = (d) => {
    const i = p.options.findIndex((o) => optValue(o) === findModule(mod.id).params[key]);
    const n = (i + d + p.options.length) % p.options.length;
    setParam(mod.id, key, optValue(p.options[n]));
  };
  const el = h('div', { class: 'ctl select' },
    h('div', { class: 'sel-body' },
      h('button', { class: 'sel-arrow', onpointerdown: (e) => e.stopPropagation(), onclick: () => step(-1) }, '‹'),
      disp,
      h('button', { class: 'sel-arrow', onpointerdown: (e) => e.stopPropagation(), onclick: () => step(1) }, '›')),
    h('label', {}, p.label));
  disp.addEventListener('click', () => {
    const cur = findModule(mod.id).params[key];
    const list = h('div', { class: 'pick-list' }, p.options.map((o) => h('button', {
      class: `pick ${optValue(o) === cur ? 'active' : ''}`,
      onclick: () => {
        setParam(mod.id, key, optValue(o));
        closePopover();
      },
    }, optLabel(o))));
    popover(disp, list, { className: 'pop-select' });
    list.querySelector('.active')?.scrollIntoView({ block: 'center' });
  });
  const update = (v) => {
    const o = p.options.find((x) => optValue(x) === v);
    disp.textContent = o ? optLabel(o) : String(v);
  };
  return { el, update };
}

// ---- sound slot: picker popover + drop target for the SAMPLES drawer ----
export function soundPicker(anchor, current, onPick) {
  const lib = library();
  const tabs = {
    ...Object.fromEntries(Object.entries(SOUND_CATEGORIES).map(([k, v]) => [k, v])),
  };
  const libGroups = [...GROUP_ORDER.filter((g) => lib[g]), ...Object.keys(lib).filter((g) => !GROUP_ORDER.includes(g))];
  const search = h('input', { class: 'pick-search', placeholder: 'search all sounds…', type: 'search' });
  const listEl = h('div', { class: 'pick-list sounds' });
  const tabBar = h('div', { class: 'pick-tabs' });
  let active = Object.keys(tabs).find((k) => tabs[k].includes(current)) ?? 'drums';
  if (getLocalNames().includes(current)) active = 'Local files';
  const all = () => [...new Set([...Object.values(tabs).flat(), ...Object.values(lib).flat().map((x) => x.name)])];
  const render = () => {
    const q = search.value.trim().toLowerCase();
    const names = q ? all().filter((n) => n.toLowerCase().includes(q)).slice(0, 300)
      : (tabs[active] ?? (lib[active] ?? []).map((x) => x.name));
    listEl.replaceChildren(...names.map((n) => h('div', { class: `pick sound ${n === current ? 'active' : ''}` },
      h('button', { class: 'aud', title: 'listen', onclick: () => audition({ s: n }) }, '▶'),
      h('button', { class: 'nm', onclick: () => { onPick(n); closePopover(); } }, prettySound(n)))));
    tabBar.querySelectorAll('button').forEach((b) => b.classList.toggle('on', !q && b.dataset.tab === active));
  };
  for (const k of [...Object.keys(tabs), ...libGroups.filter((g) => !['Synths'].includes(g))]) {
    tabBar.append(h('button', { dataset: { tab: k }, onclick: () => { active = k; search.value = ''; render(); } }, k.replace(/ \(.*\)/, '')));
  }
  search.addEventListener('input', render);
  render();
  popover(anchor, h('div', { class: 'sound-picker' }, search, tabBar, listEl), { className: 'pop-sounds' });
  setTimeout(() => search.focus(), 0);
}

export function sound(mod, key, p) {
  const disp = h('button', { class: 'lcd sound-disp', onpointerdown: (e) => e.stopPropagation() });
  const el = h('div', { class: 'ctl sound' }, disp, h('label', {}, p.label));
  disp.addEventListener('click', () => soundPicker(disp, findModule(mod.id).params[key], (n) => setParam(mod.id, key, n)));
  el.addEventListener('dragover', (e) => {
    if (e.dataTransfer.types.includes('text/bonfire-sound')) {
      e.preventDefault();
      el.classList.add('drop');
    }
  });
  el.addEventListener('dragleave', () => el.classList.remove('drop'));
  el.addEventListener('drop', (e) => {
    el.classList.remove('drop');
    const n = e.dataTransfer.getData('text/bonfire-sound');
    if (n) {
      e.preventDefault();
      setParam(mod.id, key, n);
    }
  });
  const update = (v) => {
    disp.textContent = prettySound(v);
    disp.title = v;
  };
  return { el, update };
}

export function button(mod, key, a, onPress) {
  const btn = h('button', { class: 'push', onpointerdown: (e) => { e.stopPropagation(); onPress?.(); } });
  return { el: h('div', { class: 'ctl button' }, btn, h('label', {}, a.label)), update() {} };
}

export function jack(mod, id, j, dir) {
  const el = h('div', { class: `ctl jack ${dir}`, dataset: { m: mod.id, j: id, dir, type: j.type } },
    h('div', { class: 'jack-socket', dataset: { type: j.type } }, h('div', { class: 'jack-hole' })),
    h('label', {}, j.label));
  return { el, update() {} };
}

export function led(mod, id) {
  return { el: h('div', { class: 'ctl ledbox' }, h('span', { class: 'led big', dataset: { led: id } }), h('label', {}, id === 'beat' ? 'RUN' : id)), update() {} };
}

export const FACTORIES = { knob, rotary: knob, fader, switch: switcher, toggle, select, sound };
