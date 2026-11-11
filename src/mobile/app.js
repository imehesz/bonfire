// The phone shell. Same patch, compiler and engine as the desktop rack; a different
// way to look at it: modules sit in tracks of up to three, fitted to the screen width,
// and flip over to show their jacks. No drag and drop, no zoom, no code view.
import '../styles/app.css';
import '../styles/mobile.css';
import * as store from '../core/store.js';
import { compilePatch } from '../core/compile.js';
import * as engine from '../core/engine.js';
import { initLocal, loadPack } from '../core/samples.js';
import { downloadPatch, fetchDemo, fetchDemoIndex, loadLocal, patchFromHash, pickPatchFile, saveLocal, shareUrl } from '../core/persist.js';
import { currentSkin, fetchSkinIndex, restoreSkin, skinCableSag, useSkin } from '../core/skins.js';
import { CATEGORY_ORDER, MODULES } from '../modules/index.js';
import { HP_PX } from '../core/store.js';
import { rackSettings, setCablesHidden, showModuleHelp, showModuleSettings } from '../ui/rack.js';
import { h, s, toast } from '../ui/dom.js';
import { randomName } from '../core/names.js';
import { buildCard } from './card.js';
import { MAX_PER_TRACK, canMove, move, moveTo, moveTrack, place, tracks } from './layout.js';
import { closeSheet, row, sheet } from './sheet.js';

document.body.classList.add('m-app');
const app = document.getElementById('app');

// ---------------- top bar ----------------
const playBtn = h('button', { class: 'm-play', onclick: () => engine.togglePlay() });
const nameInput = h('input', { class: 'm-name', spellcheck: 'false', 'aria-label': 'Patch name' });
nameInput.addEventListener('change', () => store.setName(nameInput.value.trim() || 'Untitled'));
nameInput.addEventListener('keydown', (e) => e.key === 'Enter' && nameInput.blur());
const flipAllBtn = h('button', { class: 'm-btn m-toggle m-flipall', onclick: () => flipAll() }, h('span', { class: 'led' }), 'REAR');
// show / hide the cables, same switch (and same saved setting) as the desktop CABLES button
const cablesBtn = h('button', { class: 'm-btn m-toggle m-cablesbtn', onclick: () => {
  setCablesHidden(!rackSettings.hideCables);
  syncCables();
} }, h('span', { class: 'led' }), 'CABLES');
const syncCables = () => {
  cablesBtn.classList.toggle('on', !rackSettings.hideCables);
  document.body.classList.toggle('m-nocables', rackSettings.hideCables);
};
syncCables();
const topbar = h('header', { class: 'm-top' },
  playBtn,
  nameInput,
  cablesBtn,
  flipAllBtn,
  h('button', { class: 'm-btn m-menu', onclick: () => mainMenu(), 'aria-label': 'Menu' }, '☰'));

const content = h('div', { class: 'm-content' });
const cableSvg = s('svg', { class: 'm-cables' });
const scroller = h('div', { class: 'm-scroll' }, content);
const stage = h('main', { class: 'stage m-stage' }, scroller); // .stage: OUTPUT's BACKDROP scope lands here
app.append(topbar, stage);

// ---------------- tracks ----------------
let rear = false; // REAR (top bar): every module turned around
let cards = new Map(); // id -> { col, card, view, sockets }
let lastWidth = 0;

function availWidth() {
  return Math.max(200, scroller.clientWidth - 20); // .m-track-row side padding
}

function render() {
  const ts = tracks();
  cards = new Map();
  lastWidth = scroller.clientWidth;
  const avail = availWidth();
  const els = ts.map((t, ti) => {
    const mods = t.map((id) => store.findModule(id));
    const px = mods.reduce((a, m) => a + MODULES[m.type].hp * HP_PX, 0) + 6 * (mods.length - 1);
    const scale = Math.min(1, avail / px);
    const cols = mods.map((m) => {
      const c = buildCard(m, { scale, flipped: rear, onMenu: moduleMenu });
      cards.set(m.id, c);
      return c.col;
    });
    return h('section', { class: 'm-track' },
      h('header', { class: 'm-track-head' }, h('div', { class: 'm-track-tab' },
        h('span', { class: 'm-track-n' }, `TRACK ${ti + 1}`),
        h('button', { class: 'm-btn xs', disabled: ti === 0, onclick: () => moveTrack(ti, -1), 'aria-label': 'Move track up' }, '▲'),
        h('button', { class: 'm-btn xs', disabled: ti === ts.length - 1, onclick: () => moveTrack(ti, 1), 'aria-label': 'Move track down' }, '▼'),
        t.length < MAX_PER_TRACK ? h('button', { class: 'm-btn xs accent', onclick: () => addSheet(ti) }, '+ ADD') : null)),
      h('div', { class: 'm-track-row' }, h('div', { class: 'rail top' }), h('div', { class: 'rail bottom' }), cols));
  });
  content.replaceChildren(...els,
    h('button', { class: 'm-btn m-newtrack', onclick: () => addSheet(null) }, '+ NEW TRACK'),
    cableSvg);
  content.classList.toggle('rear', rear);
  requestAnimationFrame(drawCables);
}

window.addEventListener('resize', () => {
  if (Math.abs(scroller.clientWidth - lastWidth) > 4) render(); // not on the URL bar sliding away
  else drawCables();
});

// ---------------- REAR + the cables ----------------
let cableT = null;
function flipAll() {
  rear = !rear;
  for (const c of cards.values()) c.card.classList.toggle('flipped', rear);
  flipAllBtn.classList.toggle('on', rear);
  cableSvg.replaceChildren(); // redrawn once the cards have turned
  clearTimeout(cableT);
  cableT = setTimeout(() => {
    content.classList.toggle('rear', rear); // cables in front of the modules, or behind them
    drawCables();
  }, 480); // .m-flip transition
}

// Look only. Always plugged into the rear sockets: face-up, those sit behind the panel
// (mirrored, like real hardware), so the wires hang behind the modules and show in
// the gaps; in REAR view they run over the panels between the jacks.
function drawCables() {
  const box = content.getBoundingClientRect();
  cableSvg.setAttribute('width', content.scrollWidth);
  cableSvg.setAttribute('height', content.scrollHeight);
  const centre = (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2 - box.left, y: r.top + r.height / 2 - box.top };
  };
  const out = [];
  for (const c of store.getPatch().cables) {
    const a = cards.get(c.from.m)?.sockets.get(`out:${c.from.j}`);
    const b = cards.get(c.to.m)?.sockets.get(`in:${c.to.j}`);
    if (!a || !b) continue;
    const p = centre(a);
    const q = centre(b);
    const sag = Math.min(220, 24 + Math.hypot(q.x - p.x, q.y - p.y) * 0.3) * skinCableSag();
    const d = `M${p.x},${p.y} C${p.x},${p.y + sag} ${q.x},${q.y + sag} ${q.x},${q.y}`;
    const g = s('g', { class: 'cable' });
    g.style.setProperty('--c', c.color);
    g.append(s('path', { d, class: 'c-shadow' }), s('path', { d, class: 'c-main' }), s('path', { d, class: 'c-hi' }),
      s('circle', { cx: p.x, cy: p.y, r: 6, class: 'plug' }), s('circle', { cx: q.x, cy: q.y, r: 6, class: 'plug' }));
    out.push(g);
  }
  cableSvg.replaceChildren(...out);
}

// ---------------- module menu (⋮) ----------------
function moduleMenu(id) {
  const m = store.findModule(id);
  const def = MODULES[m.type];
  const act = (fn) => () => {
    sh.close();
    fn();
  };
  const mv = (dir, label) => row({ label, disabled: !canMove(id, dir), onclick: act(() => move(id, dir)) });
  const sh = sheet(`${def.name} · ${(m.label || m.id).toUpperCase()}`, h('div', { class: 'm-list' },
    row({ label: `About ${def.name}`, onclick: act(() => showModuleHelp(def, store.findModule(id))) }),
    row({ label: 'Name & color…', onclick: act(() => showModuleSettings(id)) }),
    h('div', { class: 'm-group' }, 'MOVE'),
    mv('left', '◀  Move left'),
    mv('right', '▶  Move right'),
    mv('up', '▲  Into the track above'),
    mv('down', '▼  Into the track below'),
    mv('alone', '⇣  Onto its own new track'),
    h('div', { class: 'm-group' }, 'MOVE TO'),
    h('div', { class: 'm-track-picks' }, tracks().map((t, ti) => {
      const here = t.includes(id);
      const full = !here && t.length >= MAX_PER_TRACK;
      return h('button', {
        class: `m-btn m-track-pick ${here ? 'on' : ''}`, disabled: here || full,
        onclick: act(() => moveTo(id, ti)),
      }, `TRACK ${ti + 1}`, here ? h('small', {}, 'HERE') : full ? h('small', {}, 'FULL') : null);
    })),
    h('div', { class: 'm-group' }, 'MODULE'),
    row({ label: 'Duplicate', onclick: act(() => duplicate(id)) }),
    row({ label: 'Reset knobs', onclick: act(() => store.resetModule(id)) }),
    row({ label: 'Unplug all cables', onclick: act(() => store.disconnect(store.getPatch().cables.filter((c) => c.from.m === id || c.to.m === id).map((c) => c.id))) }),
    row({ label: 'Delete', className: 'danger', onclick: act(() => store.removeModule(id)) })));
}

function duplicate(id) {
  const ti = tracks().findIndex((t) => t.includes(id));
  const r = store.duplicateModule(id);
  if (r.error) return toast(r.error, 'warn');
  if (r.module) place(r.module.id, ti, id);
}

// ---------------- add a module ----------------
function addSheet(ti) {
  const where = ti == null ? 'a new track' : `track ${ti + 1}`;
  const list = [];
  for (const cat of CATEGORY_ORDER) {
    const defs = Object.values(MODULES).filter((d) => d.category === cat);
    if (!defs.length) continue;
    list.push(h('div', { class: 'm-group' }, cat.toUpperCase()));
    for (const d of defs) {
      list.push(row({
        label: d.name, hint: d.title,
        left: h('span', { class: 'm-icon', style: { backgroundImage: `url(icons/${d.type}.png)` } }),
        right: h('span', { class: 'm-info', onclick: (e) => { e.stopPropagation(); showModuleHelp(d); } }, '?'),
        onclick: () => {
          const res = store.addModule(d.type);
          if (res.error) return toast(res.error, 'warn');
          place(res.module.id, ti);
          sh.close();
          toast(`${d.name} added to ${where}`);
        },
      }));
    }
  }
  const sh = sheet(`ADD TO ${where.toUpperCase()}`, h('div', { class: 'm-list' }, list));
}

// ---------------- main menu ----------------
let demoIndex = [];
async function loadDemo(id) {
  try {
    store.loadPatch(await fetchDemo(id));
    toast(`Demo loaded: ${store.getPatch().name}`);
    await engine.play();
  } catch (e) {
    toast(e.message, 'warn');
  }
}

function mainMenu() {
  const act = (fn) => () => {
    sh.close();
    fn();
  };
  const sh = sheet('BONFIRE STACK', h('div', { class: 'm-list' },
    row({ label: '↶  Undo', onclick: () => store.undoChange() }),
    row({ label: '↷  Redo', onclick: () => store.redoChange() }),
    h('div', { class: 'm-group' }, 'PATCH'),
    row({ label: 'Demos…', onclick: act(demoSheet) }),
    row({ label: 'Random name', onclick: act(() => store.setName(randomName())) }),
    row({ label: 'New empty rack', onclick: act(() => store.loadPatch(store.emptyPatch())) }),
    row({ label: 'Open patch file…', onclick: act(async () => {
      try {
        store.loadPatch(await pickPatchFile());
      } catch (e) {
        toast(`Could not open that file: ${e.message}`, 'warn');
      }
    }) }),
    row({ label: 'Save patch file', hint: '.bonfire.json (keeps the phone + desktop layouts)', onclick: act(() => downloadPatch(store.getPatch())) }),
    row({ label: 'Copy share link', onclick: act(copyShare) }),
    h('div', { class: 'm-group' }, 'LOOK'),
    row({ label: 'Skin…', hint: currentSkin()?.name, onclick: act(skinSheet) }),
    h('div', { class: 'm-group' }, 'MORE'),
    row({ label: 'How it works', onclick: act(helpSheet) }),
    row({ label: 'Desktop version', hint: 'the full rack, best on a computer', onclick: () => { location.search = '?desktop'; } }),
    row({ label: 'Version', hint: __APP_VERSION__, disabled: true })));
}

async function copyShare() {
  const url = await shareUrl(store.getPatch());
  history.replaceState(null, '', url);
  try {
    await navigator.clipboard.writeText(url);
    toast('Share link copied: the whole patch is inside the URL');
  } catch {
    toast('Link is in the address bar');
  }
}

async function demoSheet() {
  if (!demoIndex.length) demoIndex = await fetchDemoIndex().catch(() => []);
  const sh = sheet('DEMOS', h('div', { class: 'm-list' }, demoIndex.map((d) => row({
    label: d.name, hint: d.description,
    left: h('span', { class: 'm-cover', style: { backgroundImage: `url(${d.cover})` } }),
    onclick: () => {
      sh.close();
      loadDemo(d.id);
    },
  })), h('hr'), row({
    label: 'More on BonfirePLAYER',
    onclick: () => {
      sh.close();
      window.open('https://mehesz.net/bonfireplayer/', '_blank');
    },
  })));
}

let skinIndex = [];
async function skinSheet() {
  if (!skinIndex.length) skinIndex = await fetchSkinIndex();
  const sh = sheet('SKIN', () => h('div', { class: 'm-list' }, skinIndex.map((sk) => row({
    label: sk.name, hint: sk.tagline, on: sk.id === currentSkin()?.id,
    onclick: () => useSkin(sk.id).then(() => {
      sh.render();
      requestAnimationFrame(drawCables);
    }),
  }))));
}

function helpSheet() {
  sheet('HOW IT WORKS', h('div', { class: 'm-help' },
    h('p', {}, 'Every module writes a piece of a Strudel pattern; the connections decide how the pieces join up.'),
    h('ul', {},
      h('li', {}, h('b', {}, 'Knobs: '), 'drag up / down. Double-tap to type an exact value.'),
      h('li', {}, h('b', {}, 'REAR '), '(top bar) turns every module around. The back shows each jack and what it is plugged into: tap a jack to plug or unplug it. REAR again turns them back.'),
      h('li', {}, h('b', {}, '⋮ '), 'on a module: move it between tracks, duplicate, rename, delete.'),
      h('li', {}, h('b', {}, '+ ADD '), 'puts a new module into that track (three per track at most).')),
    h('p', { class: 'm-fine' }, 'Patches made here open on the desktop rack too, and keep this phone layout.')));
}

// ---------------- store -> code -> engine ----------------
let saveT = null;
function recompile({ immediate = false } = {}) {
  const patch = store.getPatch();
  const compiled = compilePatch(patch);
  meta = compiled.meta;
  engine.setCode(compiled.code, { immediate });
  const out = patch.modules.find((m) => m.type === 'output');
  engine.setMaster(out ? out.params.volume : 0, out ? out.params.mute : false);
  for (const [id, c] of cards) c.view.el.classList.toggle('unpatched', !compiled.reachable.has(id));
  if (document.activeElement !== nameInput) nameInput.value = patch.name ?? '';
  if (compiled.errors.length) showError(compiled.errors.join(' · '));
  scheduleSave();
}
// autosave to this browser; layout-only changes (track moves) need it too
function scheduleSave() {
  clearTimeout(saveT);
  saveT = setTimeout(() => saveLocal(store.getPatch()), 400);
}
let meta = {};

let lastErr = '';
function showError(err) {
  if (err && err !== lastErr) toast(`⚠ ${err}`, 'warn');
  lastErr = err ?? '';
}

engine.onEngine((st) => {
  playBtn.classList.toggle('on', st.playing);
  playBtn.innerHTML = st.playing ? '<span>■</span> STOP' : '<span>▶</span> PLAY';
  showError(st.error);
  wakeLock(st.playing);
});
playBtn.innerHTML = '<span>▶</span> PLAY';

store.subscribe((kind, detail) => {
  if (kind === 'reset' && detail?.load) engine.fridgeReset(); // a loaded patch starts unfrozen
  if (kind === 'params') {
    if (detail?.id) cards.get(detail.id)?.view.updateParam(detail.key);
    recompile();
  } else if (kind === 'layout') {
    render();
    scheduleSave();
  } else {
    render();
    if (kind === 'reset') for (const url of store.getPatch().samplePacks ?? []) loadPack(url);
    recompile({ immediate: true });
  }
});

function frame() {
  const t = engine.now();
  for (const [id, c] of cards) c.view.tick(t, meta[id]);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------------- keep the screen on while playing ----------------
let lock = null;
async function wakeLock(on) {
  try {
    if (on && !lock && navigator.wakeLock) {
      lock = await navigator.wakeLock.request('screen');
      lock.addEventListener('release', () => (lock = null));
    } else if (!on && lock) {
      await lock.release();
      lock = null;
    }
  } catch { /* not allowed right now: fine */ }
}
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && wakeLock(engine.isPlaying()));

// ---------------- splash (the audio unlock tap) ----------------
async function splash({ shared = null } = {}) {
  if (!demoIndex.length) demoIndex = await fetchDemoIndex().catch(() => []);
  const hasSession = !!loadLocal();
  const go = (fn) => async () => {
    closeSheet();
    await engine.unlockAudio(); // inside the tap = the user gesture iOS / Android want
    await fn?.();
  };
  const body = shared
    ? h('div', { class: 'm-splash-in' },
      h('img', { class: 'm-splash-logo', src: 'brand/logo.png', alt: 'Bonfire STACK' }),
      h('p', {}, shared),
      h('button', { class: 'm-btn accent big', onclick: go(() => engine.play()) }, '▶ PLAY IT'))
    : h('div', { class: 'm-splash-in' },
      h('img', { class: 'm-splash-logo', src: 'brand/logo.png', alt: 'Bonfire STACK' }),
      h('p', {}, 'A modular synth rack in your pocket. Turn knobs, flip modules to patch them.'),
      hasSession ? h('button', { class: 'm-btn accent big', onclick: go() }, '🔥 CONTINUE MY RACK') : null,
      h('button', { class: `m-btn big ${hasSession ? '' : 'accent'}`, onclick: go(() => loadDemo('first-spark')) }, '▶ LIGHT IT UP'),
      h('button', { class: 'm-btn big', onclick: go(() => store.loadPatch(store.emptyPatch())) }, 'EMPTY RACK'),
      h('div', { class: 'm-group' }, 'OR START FROM A DEMO'),
      h('div', { class: 'm-list' }, demoIndex.map((d) => row({
        label: d.name, hint: d.description,
        left: h('span', { class: 'm-cover', style: { backgroundImage: `url(${d.cover})` } }),
        onclick: go(() => loadDemo(d.id)),
      }))));
  sheet('WELCOME', body, { className: 'm-splash', onClose: () => engine.unlockAudio().catch(() => {}) });
}

// ---------------- boot ----------------
(async () => {
  const params = new URLSearchParams(location.search);
  const skinParam = params.get('skin');
  await (skinParam ? useSkin(skinParam).catch(() => restoreSkin('bonfire')) : restoreSkin('bonfire'));
  const demoId = /#demo=([\w-]+)/.exec(location.hash)?.[1];
  const shared = (await patchFromHash()) ?? (demoId ? await fetchDemo(demoId).catch(() => null) : null);
  store.loadPatch(shared ?? loadLocal() ?? await fetchDemo('first-spark').catch(() => store.emptyPatch()), { record: false });
  engine.boot();
  initLocal();
  if (params.has('nosplash')) return;
  if (shared) splash({ shared: demoId ? `Demo: “${store.getPatch().name}”` : `Someone shared a patch with you: “${store.getPatch().name}”` });
  else splash();
})();
