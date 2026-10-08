// Side drawers: MODULES (left) and SAMPLES (right).
import { CATEGORY_ORDER, MODULES } from '../modules/index.js';
import { addModule, addModules, addSamplePack, getPatch, removeSamplePack } from '../core/store.js';
import { audition } from '../core/engine.js';
import {
  GROUP_ORDER, addLocalFiles, forgetPack, getLocalNames, library, loadPack, onLibrary, packKey, packState, removeLocalSound,
} from '../core/samples.js';
import { prettySound } from '../core/music.js';
import { h, modal, toast } from './dom.js';
import { showModuleHelp } from './rack.js';

function drawer(side, title, body) {
  const el = h('aside', { class: `drawer ${side}` },
    h('header', {}, h('h3', {}, title), h('button', { class: 'x', onclick: () => el.classList.remove('open') }, '×')),
    body);
  return el;
}

// CTRL/CMD-click cards to select several; + on a selected card adds them all (in click order).
function addSelected(selected, render) {
  const types = [...selected];
  const run = () => {
    const { added, skipped } = addModules(types);
    selected.clear();
    render();
    const names = (list) => list.map((t) => MODULES[t].name).join(', ');
    if (added.length) toast(`${added.length} module${added.length === 1 ? '' : 's'} added`);
    if (skipped.length) toast(`Only one per rack, skipped: ${names(skipped)}`, 'warn');
  };
  if (types.length < 2) return run();
  const dlg = modal(h('div', { class: 'confirm' },
    h('p', {}, 'Are you sure you want to add ', h('b', {}, types.length), ' modules to the rack?'),
    h('div', { class: 'confirm-actions' },
      h('button', { class: 'btn', onclick: () => dlg.close() }, 'CANCEL'),
      h('button', { class: 'btn accent', onclick: () => { dlg.close(); run(); } }, 'ADD'))), { className: 'modal-confirm' });
}

export function mountModuleDrawer(host) {
  const search = h('input', { type: 'search', placeholder: 'find a module…', class: 'drawer-search' });
  const list = h('div', { class: 'mod-list' });
  const selected = new Set(); // module types, in the order they were picked
  const render = () => {
    const q = search.value.trim().toLowerCase();
    list.replaceChildren();
    for (const cat of CATEGORY_ORDER) {
      const defs = Object.values(MODULES).filter((d) => d.category === cat
        && (!q || `${d.name} ${d.title} ${d.description}`.toLowerCase().includes(q)));
      if (!defs.length) continue;
      list.append(h('div', { class: 'cat' }, cat.toUpperCase()));
      for (const d of defs) {
        const card = h('div', {
          class: `mod-card ${selected.has(d.type) ? 'selected' : ''}`,
          draggable: 'true',
          title: 'Drag onto the rack, or click + to add. CTRL-click to select several.',
        },
          h('div', { class: 'mc-icon', style: { backgroundImage: `url(icons/${d.type}.png)` } }),
          h('div', { class: 'mc-text' },
            h('div', { class: 'mc-name' }, d.name, h('span', { class: 'mc-hp' }, `${d.hp} HP`)),
            h('div', { class: 'mc-title' }, d.title),
            h('div', { class: 'mc-desc' }, d.description)),
          h('div', { class: 'mc-actions' },
            h('button', { class: 'mc-add', title: 'Add to rack', onclick: (e) => {
              if (e.ctrlKey || e.metaKey) return; // the card's handler toggles the selection
              if (selected.has(d.type)) return addSelected(selected, render);
              const res = addModule(d.type);
              toast(res.error ?? `${d.name} added`, res.error ? 'warn' : '');
            } }, '+'),
            h('button', { class: 'mc-info', title: 'What does it do?', onclick: () => showModuleHelp(d) }, '?')));
        card.addEventListener('click', (e) => {
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            selected.has(d.type) ? selected.delete(d.type) : selected.add(d.type);
            card.classList.toggle('selected', selected.has(d.type));
          } else if (!e.target.closest('button') && selected.size) {
            selected.clear();
            render();
          }
        });
        card.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('text/bonfire-module', d.type);
          e.dataTransfer.effectAllowed = 'copy';
        });
        list.append(card);
      }
    }
  };
  search.addEventListener('input', render);
  render();
  const el = drawer('left', 'MODULES', h('div', { class: 'drawer-body' }, search, list));
  host.append(el);
  return el;
}

const DRUM_MACHINE = /^([A-Za-z0-9]+)_(.+)$/;

function soundRow(name, variants, local) {
  const row = h('div', { class: 'snd', draggable: 'true', title: `${name} — drag onto a SOUND / SAMPLE display` },
    h('button', { class: 'aud', onclick: () => audition({ s: name }) }, '▶'),
    h('span', { class: 'snd-name' }, prettySound(name)),
    variants > 1 ? h('span', { class: 'snd-n', title: `${variants} variants — pick with VARIANT / n` }, `×${variants}`) : null,
    local ? h('button', { class: 'snd-del', title: 'remove from this browser', onclick: () => removeLocalSound(name) }, '×') : null);
  row.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/bonfire-sound', name);
    e.dataTransfer.setData('text/plain', name);
  });
  return row;
}

export function mountSampleDrawer(host) {
  const open = new Set(['Drum Kit']);
  const search = h('input', { type: 'search', placeholder: 'search sounds…', class: 'drawer-search' });
  const groupsEl = h('div', { class: 'snd-groups' });
  const packInput = h('input', { class: 'pack-input', placeholder: 'github:user/repo  ·  shabda:bass:4,snare:2  ·  https://…/strudel.json' });
  const packList = h('div', { class: 'pack-list' });
  const fileInput = h('input', { type: 'file', multiple: true, accept: 'audio/*', style: { display: 'none' } });
  const dropZone = h('div', { class: 'drop-zone', onclick: () => fileInput.click() },
    h('strong', {}, 'Drop audio files here'), h('span', {}, 'or click to choose · stays in this browser'));

  const addPack = async () => {
    const url = packInput.value.trim();
    if (!url) return;
    addSamplePack(url);
    packInput.value = '';
    await loadPack(url);
    const st = packState().find(([u]) => u === url)?.[1];
    if (st !== 'ok') toast(`Pack failed: ${st}`, 'warn');
    else toast('Pack loaded — it is now a samples() line in your code');
  };
  packInput.addEventListener('keydown', (e) => e.key === 'Enter' && addPack());
  fileInput.addEventListener('change', async () => {
    const n = await addLocalFiles(fileInput.files);
    toast(`Added ${n} file${n === 1 ? '' : 's'}`);
    fileInput.value = '';
    open.add('Local files');
    render();
  });
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('over');
  });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('over'));
  dropZone.addEventListener('drop', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove('over');
    const n = await addLocalFiles(e.dataTransfer.files);
    toast(`Added ${n} file${n === 1 ? '' : 's'}`);
    open.add('Local files');
    render();
  });

  function renderPacks() {
    const states = new Map(packState());
    packList.replaceChildren(...getPatch().samplePacks.map((pack) => {
      const url = packKey(pack);
      const st = states.get(url) ?? 'not loaded';
      return h('div', { class: `pack ${st === 'ok' ? 'ok' : st === 'loading' ? 'loading' : 'bad'}` },
        h('span', { class: 'pack-url', title: url }, url),
        h('span', { class: 'pack-st' }, st === 'ok' ? '✓' : st === 'loading' ? '…' : '!'),
        h('button', { class: 'snd-del', title: 'remove pack', onclick: () => { removeSamplePack(pack); forgetPack(pack); } }, '×'));
    }));
  }

  function render() {
    renderPacks();
    const lib = library();
    const q = search.value.trim().toLowerCase();
    const localSet = new Set(getLocalNames());
    const names = [...GROUP_ORDER.filter((g) => lib[g]), ...Object.keys(lib).filter((g) => !GROUP_ORDER.includes(g)).sort()];
    groupsEl.replaceChildren();
    for (const g of names) {
      const items = lib[g].filter((x) => !q || x.name.toLowerCase().includes(q));
      if (!items.length) continue;
      const isOpen = q || open.has(g);
      const head = h('button', { class: `grp-head ${isOpen ? 'open' : ''}`, onclick: () => { open.has(g) ? open.delete(g) : open.add(g); render(); } },
        h('span', {}, g.startsWith('Pack · ') ? `📦 ${g.slice(7)}` : g), h('em', {}, items.length));
      groupsEl.append(head);
      if (!isOpen) continue;
      const body = h('div', { class: 'grp-body' });
      if (g === 'Drum Machines' && !q) {
        const banks = {};
        for (const it of items) {
          const m = DRUM_MACHINE.exec(it.name);
          (banks[m ? m[1] : 'other'] ??= []).push(it);
        }
        for (const [bank, list] of Object.entries(banks).sort()) {
          const key = `bank:${bank}`;
          body.append(h('button', { class: `bank-head ${open.has(key) ? 'open' : ''}`, onclick: () => { open.has(key) ? open.delete(key) : open.add(key); render(); } }, bank, h('em', {}, list.length)));
          if (open.has(key)) body.append(...list.map((it) => soundRow(it.name, it.variants)));
        }
      } else {
        body.append(...items.slice(0, 400).map((it) => soundRow(it.name, it.variants, localSet.has(it.name))));
      }
      groupsEl.append(body);
    }
    if (!groupsEl.children.length) groupsEl.append(h('div', { class: 'empty' }, 'Sounds are still loading — or nothing matches.'));
  }
  search.addEventListener('input', render);
  onLibrary(render);

  const el = drawer('right', 'SAMPLES', h('div', { class: 'drawer-body' },
    h('p', { class: 'drawer-tip' }, 'Drag any sound onto a SOUND / SAMPLE display. ▶ to listen.'),
    search,
    groupsEl,
    h('div', { class: 'drawer-sec' }, h('h4', {}, 'SAMPLE PACKS'),
      h('div', { class: 'pack-add' }, packInput, h('button', { class: 'btn', onclick: addPack }, 'LOAD')),
      h('p', { class: 'drawer-tip' }, 'Packs become a samples(\'…\') line in the code, so they work on strudel.cc too. shabda: pulls sounds from freesound by keyword.'),
      packList),
    h('div', { class: 'drawer-sec' }, h('h4', {}, 'YOUR FILES'), dropZone, fileInput,
      h('p', { class: 'drawer-tip' }, 'Local files play here but are not on strudel.cc — the code marks them.'))));
  host.append(el);
  el.addEventListener('transitionend', () => el.classList.contains('open') && render());
  return { el, render };
}
