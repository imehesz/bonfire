// One module on the phone: a card that flips. FRONT = the real faceplate with its jacks
// hidden; BACK = the rear panel, one row per jack saying what it's plugged into.
// Tapping a rear row opens the connection picker (the MODCONS logic, as a sheet).
import { MODULES, compatible } from '../modules/index.js';
import { HP_PX, connect, disconnect, findModule, getPatch, rewire } from '../core/store.js';
import { wouldCycle } from '../core/compile.js';
import { buildModule, paintPanel } from '../ui/module.js';
import { h } from '../ui/dom.js';
import { row, sheet } from './sheet.js';
import { tracks } from './layout.js';

const nameOf = (m) => (m.label || m.id).toUpperCase();
const TYPE_HINT = { pattern: 'sound', pitch: 'notes', rhythm: 'rhythm', cv: 'CV', clock: 'clock' };

// other modules' jacks on side `dir` that `ok` accepts, in phone order (track by track)
function choices(selfId, dir, ok) {
  const order = tracks().flat();
  return getPatch().modules
    .filter((o) => o.id !== selfId)
    .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
    .map((o) => {
      const def = MODULES[o.type];
      const jacks = Object.entries(dir === 'out' ? def.outputs : def.inputs).filter(([j, spec]) => ok(o, j, spec));
      return jacks.length ? { o, def, jacks } : null;
    })
    .filter(Boolean);
}

const dot = (type, color) => h('span', { class: `jt jt-${type} m-dot`, style: color ? { background: color, borderColor: color } : {} });

// The picker for one jack. Inputs take one cable (tap = plug / replug, close);
// outputs fan out (tap toggles, the sheet stays open until DONE).
export function openJackSheet(modId, dir, j) {
  const m = findModule(modId);
  const def = MODULES[m.type];
  const spec = (dir === 'in' ? def.inputs : def.outputs)[j];
  const title = `${nameOf(m)} › ${spec.label}`;
  let s;
  const content = () => {
    const patch = getPatch();
    if (!findModule(modId)) return h('p', { class: 'm-empty' }, 'This module is gone.');
    const list = [];
    if (dir === 'in') {
      const to = { m: modId, j };
      const cable = patch.cables.find((c) => c.to.m === modId && c.to.j === j);
      const cur = cable ? `${cable.from.m}|${cable.from.j}` : '';
      list.push(row({ label: '— unplugged —', on: !cable, onclick: () => { if (cable) disconnect(cable.id); s.close(); } }));
      for (const { o, def: od, jacks } of choices(modId, 'out', (o, oj, os) => compatible(os.type, spec.type)
        && (!wouldCycle(patch, o.id, modId) || cur === `${o.id}|${oj}`))) {
        list.push(h('div', { class: 'm-group' }, `${od.name} · ${nameOf(o)}`));
        for (const [oj, os] of jacks) {
          const on = cur === `${o.id}|${oj}`;
          list.push(row({
            label: `${nameOf(o)} › ${os.label}`, hint: TYPE_HINT[os.type], on, left: dot(os.type, on ? cable.color : null),
            onclick: () => {
              if (!on) cable ? rewire(cable.id, { m: o.id, j: oj }, to) : connect({ m: o.id, j: oj }, to);
              s.close();
            },
          }));
        }
      }
    } else {
      const from = { m: modId, j };
      const mine = patch.cables.filter((c) => c.from.m === modId && c.from.j === j);
      for (const { o, def: od, jacks } of choices(modId, 'in', (o, ij, is) => compatible(spec.type, is.type)
        && (!wouldCycle(patch, modId, o.id) || mine.some((c) => c.to.m === o.id && c.to.j === ij)))) {
        list.push(h('div', { class: 'm-group' }, `${od.name} · ${nameOf(o)}`));
        for (const [ij, is] of jacks) {
          const c = mine.find((x) => x.to.m === o.id && x.to.j === ij);
          const other = !c && patch.cables.find((x) => x.to.m === o.id && x.to.j === ij);
          list.push(row({
            label: `${nameOf(o)} › ${is.label}`,
            hint: c ? 'connected · tap to unplug' : other ? `in use by ${nameOf(findModule(other.from.m) ?? { id: other.from.m })} · tap to replace` : TYPE_HINT[is.type],
            on: !!c, left: dot(is.type, c?.color),
            right: h('span', { class: `m-check ${c ? 'on' : ''}` }),
            onclick: () => (c ? disconnect(c.id) : connect(from, { m: o.id, j: ij })),
          }));
        }
      }
      if (!list.length) list.push(h('p', { class: 'm-empty' }, 'Nothing in the rack can take this output yet. Add a module first.'));
    }
    return h('div', { class: 'm-list' }, list);
  };
  s = sheet(title, content, {
    className: 'm-jack-sheet',
    actions: dir === 'out' ? h('button', { class: 'm-btn accent wide', onclick: () => s.close() }, 'DONE') : null,
  });
  return s;
}

// what one jack is plugged into, for the rear panel
function plugged(m, dir, j) {
  const patch = getPatch();
  const cs = patch.cables.filter((c) => (dir === 'in' ? c.to.m === m.id && c.to.j === j : c.from.m === m.id && c.from.j === j));
  return cs.map((c) => {
    const end = dir === 'in' ? c.from : c.to;
    const o = findModule(end.m);
    const od = o && MODULES[o.type];
    const label = (dir === 'in' ? od?.outputs : od?.inputs)?.[end.j]?.label ?? end.j;
    return { cable: c, text: `${o ? nameOf(o) : end.m} › ${label}` };
  });
}

function buildBack(mod, sockets) {
  const def = MODULES[mod.type];
  const rows = [];
  const jackRow = (dir, j, spec) => {
    const links = plugged(mod, dir, j);
    const socket = h('span', { class: 'jack-socket', dataset: { type: spec.type } }, h('span', { class: 'jack-hole' }));
    if (links.length) socket.append(h('span', { class: 'm-plug', style: { '--c': links[0].cable.color } }));
    sockets.set(`${dir}:${j}`, socket);
    rows.push(h('button', { class: `m-jrow ${dir} ${links.length ? 'patched' : ''}`, onclick: () => openJackSheet(mod.id, dir, j) },
      socket,
      h('span', { class: 'm-jtext' },
        h('b', {}, spec.label, h('i', {}, dir === 'in' ? ' IN' : ' OUT')),
        links.length
          ? links.map((l) => h('span', { class: 'm-link', style: { '--c': l.cable.color } }, `${dir === 'in' ? '←' : '→'} ${l.text}`))
          : h('span', { class: 'm-link none' }, dir === 'out' ? '+ connect' : '— unplugged —'))));
  };
  for (const [j, spec] of Object.entries(def.inputs)) jackRow('in', j, spec);
  for (const [j, spec] of Object.entries(def.outputs)) jackRow('out', j, spec);
  const el = h('div', { class: 'm-rear', style: { width: `${def.hp * HP_PX}px` } },
    h('div', { class: 'mod-tex' }),
    h('i', { class: 'screw tl' }), h('i', { class: 'screw tr' }), h('i', { class: 'screw bl' }), h('i', { class: 'screw br' }),
    h('div', { class: 'm-rear-head' }, h('div', { class: 'mod-name' }, def.name), h('div', { class: 'mod-id' }, `REAR · ${mod.label || mod.id}`)),
    h('div', { class: 'm-rear-rows' }, rows.length ? rows : h('p', { class: 'm-rear-none' }, 'NO JACKS')),
    h('div', { class: 'mod-foot' }, 'BONFIRE'));
  paintPanel(el, mod.color);
  return el;
}

// scale: the track's fit-to-width factor (CSS zoom, so taps and drags stay exact)
export function buildCard(mod, { scale, flipped, onMenu }) {
  const def = MODULES[mod.type];
  const view = buildModule(mod);
  const sockets = new Map();
  const back = buildBack(mod, sockets);
  const card = h('div', { class: `m-card ${flipped ? 'flipped' : ''}`, style: { zoom: scale } },
    h('div', { class: 'm-flip' },
      h('div', { class: 'm-face m-front' }, view.el),
      h('div', { class: 'm-face m-back' }, back)));
  // ⋮ right of the module's name, on both faces, up in the title strip away from the
  // knobs; an empty slot on the left keeps the name centred
  const headTools = (head) => {
    const title = h('div', { class: 'm-title' }, ...head.childNodes);
    head.classList.add('m-head');
    head.classList.toggle('narrow', def.hp <= 8);
    head.replaceChildren(
      h('span', { class: 'm-hgap' }),
      title,
      h('button', { class: 'm-hbtn m-hmenu', onclick: (e) => onMenu(mod.id, e.currentTarget), 'aria-label': 'Module menu' }, '⋮'));
  };
  headTools(view.el.querySelector('.mod-head'));
  headTools(back.querySelector('.m-rear-head'));
  const col = h('div', { class: 'm-col', dataset: { id: mod.id }, style: { width: `${def.hp * HP_PX * scale}px` } }, card);
  return { col, card, view, sockets };
}
