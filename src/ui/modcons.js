// MODCONS dock tab: the selected module's jacks and what each is plugged into, with a
// drop-down per connection to replug / unplug without dragging cables.
import { MODULES, compatible } from '../modules/index.js';
import { connect, disconnect, findModule, getPatch, rewire, subscribe } from '../core/store.js';
import { wouldCycle } from '../core/compile.js';
import { h } from './dom.js';

const nameOf = (m) => m.label || m.id;
const key = (end) => `${end.m}|${end.j}`;
const parse = (v) => {
  const [m, j] = v.split('|');
  return { m, j };
};

export function mountModcons() {
  const el = h('div', { class: 'modcons' });
  let current = null;

  // every other module's jacks on side `dir` that `ok` accepts, grouped by module in rack order
  const choices = (dir, ok) => [...getPatch().modules]
    .filter((o) => o.id !== current)
    .sort((a, b) => a.row - b.row || a.x - b.x)
    .map((o) => {
      const def = MODULES[o.type];
      const jacks = Object.entries(dir === 'out' ? def.outputs : def.inputs).filter(([j, spec]) => ok(o, j, spec));
      return jacks.length ? { o, def, jacks } : null;
    })
    .filter(Boolean);

  const picker = (blank, groups, value, onPick, note = () => '') => {
    const sel = h('select', { class: 'mc-select' },
      h('option', { value: '' }, blank),
      groups.map(({ o, def, jacks }) => h('optgroup', { label: `${def.name} · ${nameOf(o)}` },
        jacks.map(([j, spec]) => h('option', { value: `${o.id}|${j}` }, `${nameOf(o)} › ${spec.label}${note(o, j)}`)))));
    sel.value = value;
    sel.addEventListener('change', () => onPick(sel.value));
    return sel;
  };

  const dot = (type, cable) => h('span', {
    class: `jt jt-${type} mc-dot`,
    style: cable ? { background: cable.color, borderColor: cable.color } : {},
  });

  const row = (label, type, cable, sel) => h('div', { class: 'mc-row' },
    h('span', { class: 'mc-port' }, label), dot(type, cable), sel);

  function render() {
    const m = current && findModule(current);
    if (!m) {
      current = null;
      el.replaceChildren(h('p', { class: 'mc-empty' }, 'Click a module in the rack to see its connections here.'));
      return;
    }
    const patch = getPatch();
    const def = MODULES[m.type];
    const rows = [];

    const ins = Object.entries(def.inputs);
    if (ins.length) rows.push(h('h4', {}, 'INPUTS'));
    for (const [j, spec] of ins) {
      const to = { m: m.id, j };
      const cable = patch.cables.find((c) => c.to.m === m.id && c.to.j === j);
      const groups = choices('out', (o, oj, ospec) => compatible(ospec.type, spec.type)
        && (!wouldCycle(patch, o.id, m.id) || (cable && key(cable.from) === `${o.id}|${oj}`)));
      rows.push(row(spec.label, spec.type, cable, picker('— unplugged —', groups, cable ? key(cable.from) : '', (v) => {
        if (!v) return cable && disconnect(cable.id);
        return cable ? rewire(cable.id, parse(v), to) : connect(parse(v), to);
      })));
    }

    const outs = Object.entries(def.outputs);
    if (outs.length) rows.push(h('h4', {}, 'OUTPUTS'));
    for (const [j, spec] of outs) {
      const from = { m: m.id, j };
      const cables = patch.cables.filter((c) => c.from.m === m.id && c.from.j === j);
      // an input already fed by a different cable: picking it replaces that cable
      const taken = (mine) => (o, ij) => (patch.cables.some((c) => c !== mine && c.to.m === o.id && c.to.j === ij) ? ' (in use)' : '');
      const targets = (mine) => choices('in', (o, ij, ispec) => compatible(spec.type, ispec.type)
        && (!wouldCycle(patch, m.id, o.id) || (mine && key(mine.to) === `${o.id}|${ij}`)));
      cables.forEach((c, i) => rows.push(row(i ? '' : spec.label, spec.type, c,
        picker('— unplug —', targets(c), key(c.to), (v) => (v ? rewire(c.id, from, parse(v)) : disconnect(c.id)), taken(c)))));
      // outputs fan out: there is always one more free slot
      rows.push(row(cables.length ? '' : spec.label, spec.type, null,
        picker(cables.length ? '+ add a connection…' : '— unplugged —', targets(null), '', (v) => v && connect(from, parse(v)), taken(null))));
    }

    el.replaceChildren(
      h('div', { class: 'mc-head' }, h('b', {}, def.name), h('span', {}, nameOf(m))),
      rows.length ? h('div', { class: 'mc-list' }, rows) : h('p', { class: 'mc-empty' }, 'This module has no jacks.'));
  }

  document.addEventListener('bonfire:select', (e) => {
    current = e.detail;
    render();
  });
  subscribe((kind) => kind !== 'params' && render());
  render();
  return { el };
}
