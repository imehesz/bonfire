// Builds one module's faceplate from its ModuleDefinition layout.
import { MODULES } from '../modules/index.js';
import { HP_PX, findModule, setParam } from '../core/store.js';
import { FACTORIES, button, jack, led } from './controls.js';
import { WIDGETS } from './widgets.js';
import { h } from './dom.js';

const taps = {};

function tapTempo(mod) {
  const now = performance.now();
  const list = (taps[mod.id] ?? []).filter((t) => now - t < 2500);
  list.push(now);
  taps[mod.id] = list.slice(-5);
  if (list.length < 2) return;
  const gaps = list.slice(1).map((t, i) => t - list[i]);
  const bpm = Math.round(60000 / (gaps.reduce((a, b) => a + b, 0) / gaps.length));
  setParam(mod.id, 'bpm', Math.min(240, Math.max(40, bpm)));
}

// preview: a look-only faceplate (help dialog) that reads mod.params instead of the store.
export function buildModule(mod, { preview = false } = {}) {
  const def = MODULES[mod.type];
  const params = () => (preview ? mod.params : findModule(mod.id)?.params);
  const controls = {};
  const widgets = [];
  const jacks = {};
  const leds = {};

  const item = (spec) => {
    if (spec.startsWith('in:') || spec.startsWith('out:')) {
      const [dir, id] = spec.split(':');
      const j = (dir === 'in' ? def.inputs : def.outputs)[id];
      const c = jack(mod, id, j, dir);
      jacks[`${dir}:${id}`] = c.el;
      return c.el;
    }
    if (spec.startsWith('widget:')) {
      const w = WIDGETS[spec.slice(7)](mod, def);
      widgets.push(w);
      return w.el;
    }
    if (spec.startsWith('led:')) {
      const c = led(mod, spec.slice(4));
      leds[spec.slice(4)] = c.el.querySelector('.led');
      return c.el;
    }
    if (def.actions?.[spec]) {
      return button(mod, spec, def.actions[spec], () => (spec === 'tap' ? tapTempo(mod) : widgets.forEach((w) => w.action?.(spec)))).el;
    }
    const p = def.params[spec];
    const c = FACTORIES[p.kind](mod, spec, p);
    c.el.dataset.param = spec;
    controls[spec] = c;
    return c.el;
  };

  const body = h('div', { class: 'mod-body' },
    def.layout.map((row) => h('div', { class: `mod-row ${row.some((r) => r.startsWith('in:') || r.startsWith('out:')) ? 'jacks' : ''}` }, row.map(item))));

  const el = h('div', {
    class: 'module',
    dataset: { id: mod.id, type: mod.type },
    style: { width: `${def.hp * HP_PX}px` },
  },
  h('div', { class: 'mod-tex' }),
  h('i', { class: 'screw tl' }), h('i', { class: 'screw tr' }), h('i', { class: 'screw bl' }), h('i', { class: 'screw br' }),
  h('div', { class: 'mod-head' }, h('div', { class: 'mod-name' }, def.name), h('div', { class: 'mod-id' }, mod.id)),
  body,
  h('div', { class: 'mod-foot' }, 'BONFIRE'));

  const update = () => {
    const p = params();
    if (!p) return;
    for (const [k, c] of Object.entries(controls)) c.update(p[k]);
    for (const w of widgets) w.update(p);
    // VOICE / SAMPLER: hide controls that don't apply to the current mode
    if (mod.type === 'voice') {
      el.classList.toggle('mode-synth', p.mode === 'synth');
      el.classList.toggle('mode-sample', p.mode === 'sample');
    }
    if (mod.type === 'sampler') el.dataset.mode = p.mode;
  };
  update();

  return {
    el,
    update,
    updateParam: (key) => {
      const p = params();
      if (!p) return;
      if (controls[key]) controls[key].update(p[key]);
      widgets.forEach((w) => w.update(p));
      if (key === 'mode') update();
    },
    tick(cycle, meta) {
      for (const w of widgets) w.tick(cycle, meta);
      if (leds.beat) leds.beat.classList.toggle('on', cycle != null && (cycle * 4) % 1 < 0.18);
    },
    jacks,
  };
}
