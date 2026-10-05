import './styles/app.css';
import * as store from './core/store.js';
import { compilePatch } from './core/compile.js';
import * as engine from './core/engine.js';
import { initLocal, loadPack } from './core/samples.js';
import { downloadPatch, fetchDemo, fetchDemoIndex, loadLocal, patchFromHash, pickPatchFile, saveLocal, shareUrl } from './core/persist.js';
import { currentSkin, fetchSkinIndex, restoreSkin, useCustomSkin, useSkin } from './core/skins.js';
import * as rack from './ui/rack.js';
import { mountInspector } from './ui/inspector.js';
import { mountModuleDrawer, mountSampleDrawer } from './ui/drawers.js';
import { h, menu, modal, readout, toast } from './ui/dom.js';
import { randomName } from './core/names.js';

const SOURCE_URL = 'https://github.com/imehesz/bonfirestack';
const COFFEE_URL = 'https://buymeacoffee.com/imehesz';

const app = document.getElementById('app');
let meta = {};
let compiled = null;

// ---------------- layout ----------------
const playBtn = h('button', { class: 'transport', title: 'Play / stop (Space)', onclick: () => engine.togglePlay() });
const nameInput = h('input', { class: 'patch-name', spellcheck: 'false', title: 'Patch name' });
nameInput.addEventListener('change', () => store.setName(nameInput.value.trim() || 'Untitled'));
nameInput.addEventListener('keydown', (e) => e.key === 'Enter' && nameInput.blur());
const zoomLabel = h('span', { class: 'zoom-val' });

// dice: untitled patches just get a name; a named one asks before it's replaced
const DIE_SVG = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4"/><g fill="currentColor" stroke="none"><circle cx="8" cy="8" r="1.6"/><circle cx="16" cy="8" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="8" cy="16" r="1.6"/><circle cx="16" cy="16" r="1.6"/></g></svg>';
function rollName() {
  const cur = (store.getPatch().name ?? '').trim();
  const next = randomName();
  if (!cur || cur === 'Untitled') return store.setName(next);
  const dlg = modal(h('div', { class: 'confirm' },
    h('p', {}, 'Replace the name ', h('b', {}, `“${cur}”`), ' with ', h('b', {}, `“${next}”`), '?'),
    h('div', { class: 'confirm-actions' },
      h('button', { class: 'btn', onclick: () => dlg.close() }, 'KEEP'),
      h('button', { class: 'btn accent', onclick: () => { store.setName(next); dlg.close(); } }, 'REPLACE'))), { className: 'modal-confirm' });
}

const cablesLed = h('span', { class: 'led' });
const syncCablesBtn = () => cablesLed.classList.toggle('on', !rack.rackSettings.hideCables);
const cablesBtn = h('button', {
  class: 'tb cables-toggle', title: 'Show / hide the cables (patching still works)',
  onclick: () => { rack.setCablesHidden(!rack.rackSettings.hideCables); syncCablesBtn(); },
}, cablesLed, 'CABLES');
syncCablesBtn();

const topbar = h('header', { class: 'topbar' },
  h('button', { class: 'brand', title: 'About Bonfire STACK', onclick: () => showSplash() }, h('img', { src: 'brand/logo.png', alt: 'Bonfire STACK' })),
  playBtn,
  nameInput,
  h('button', { class: 'tb icon dice', title: 'Random name', onclick: rollName, html: DIE_SVG }),
  h('nav', { class: 'tb-nav' },
    h('button', { class: 'tb', onclick: () => toggleDrawer('left') }, 'MODULES'),
    h('button', { class: 'tb', onclick: () => toggleDrawer('right') }, 'SAMPLES'),
    h('button', { class: 'tb', onclick: (e) => patchMenu(e.currentTarget) }, 'PATCH ▾'),
    h('button', { class: 'tb', onclick: (e) => demoMenu(e.currentTarget) }, 'DEMOS ▾'),
    h('button', { class: 'tb', onclick: (e) => skinMenu(e.currentTarget) }, 'SKIN ▾'),
    cablesBtn,
    readout),
  h('div', { class: 'tb-right' },
    h('button', { class: 'tb icon', title: 'Undo (Ctrl+Z)', onclick: store.undoChange }, '↶'),
    h('button', { class: 'tb icon', title: 'Redo (Ctrl+Shift+Z)', onclick: store.redoChange }, '↷'),
    h('div', { class: 'zoom' },
      h('button', { class: 'tb icon', title: 'Zoom out (Ctrl+wheel)', onclick: () => rack.setZoom(rack.rackSettings.zoom / 1.1) }, '−'),
      zoomLabel,
      h('button', { class: 'tb icon', title: 'Zoom in', onclick: () => rack.setZoom(rack.rackSettings.zoom * 1.1) }, '+')),
    h('button', { class: 'tb', title: 'Settings', onclick: (e) => settingsMenu(e.currentTarget) }, '⚙'),
    h('button', { class: 'tb', onclick: showHelp }, 'HELP'),
    h('a', {
      class: 'tb icon coffee', href: COFFEE_URL, target: '_blank', rel: 'noopener', title: 'Buy me a coffee',
      html: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/><path d="M17 11h1.5a2.5 2.5 0 0 1 0 5H16.5"/><path d="M8 3c0 1.5 1.2 1.5 1.2 3M12 3c0 1.5 1.2 1.5 1.2 3"/></svg>',
    })));

const main = h('main', { class: 'stage' });
app.append(topbar, main);
rack.mountRack(main);
const leftDrawer = mountModuleDrawer(app);
const samplesDrawer = mountSampleDrawer(app);
const inspector = mountInspector(app);

function toggleDrawer(side) {
  const el = side === 'left' ? leftDrawer : samplesDrawer.el;
  el.classList.toggle('open');
  if (side === 'right' && el.classList.contains('open')) samplesDrawer.render();
}

const updateZoom = () => (zoomLabel.textContent = `${Math.round(rack.rackSettings.zoom * 100)}%`);
document.addEventListener('bonfire:zoom', updateZoom);
updateZoom();

// ---------------- store -> code -> engine ----------------
let saveT = null;
function recompile({ immediate = false } = {}) {
  const patch = store.getPatch();
  compiled = compilePatch(patch);
  meta = compiled.meta;
  inspector.setCode(compiled.code);
  engine.setCode(compiled.code, { immediate });
  rack.markReachable(compiled.reachable);
  const out = patch.modules.find((m) => m.type === 'output');
  engine.setMaster(out ? out.params.volume : 0, out ? out.params.mute : false);
  if (document.activeElement !== nameInput) nameInput.value = patch.name ?? '';
  refreshStatus();
  clearTimeout(saveT);
  saveT = setTimeout(() => saveLocal(store.getPatch()), 400);
}

let engineState = { playing: false, loading: true, error: null };
function refreshStatus() {
  inspector.setStatus({ ...engineState, compileErrors: compiled?.errors ?? [] });
  playBtn.classList.toggle('on', engineState.playing);
  playBtn.innerHTML = engineState.playing ? '<span>■</span> STOP' : '<span>▶</span> PLAY';
}
engine.onEngine((s) => {
  engineState = s;
  refreshStatus();
});

store.subscribe((kind, detail) => {
  if (kind === 'params') {
    if (detail?.id) rack.updateParam(detail.id, detail.key);
    recompile();
  } else if (kind === 'structure') {
    rack.sync();
    recompile({ immediate: true });
  } else {
    rack.rebuild();
    for (const url of store.getPatch().samplePacks ?? []) loadPack(url);
    recompile({ immediate: true });
  }
});

// ---------------- animation loop (playheads, LEDs, scope) ----------------
function frame() {
  rack.tick(engine.now(), meta);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------------- menus ----------------
async function loadDemo(id, { autoplay = true } = {}) {
  try {
    store.loadPatch(await fetchDemo(id));
    toast(`Demo loaded: ${store.getPatch().name}`);
    if (autoplay) await engine.play();
  } catch (e) {
    toast(e.message, 'warn');
  }
}

function patchMenu(anchor) {
  menu(anchor, [
    { label: 'New empty rack', action: () => store.loadPatch(store.emptyPatch()) },
    '-',
    { label: 'Open patch file…', action: async () => {
      try {
        store.loadPatch(await pickPatchFile());
      } catch (e) {
        toast(`Could not open that file: ${e.message}`, 'warn');
      }
    } },
    { label: 'Save patch file', hint: '.bonfire.json', action: () => downloadPatch(store.getPatch()) },
    { label: 'Copy share link', action: async () => {
      const url = await shareUrl(store.getPatch());
      history.replaceState(null, '', url);
      try {
        await navigator.clipboard.writeText(url);
        toast('Share link copied — the whole patch is inside the URL');
      } catch {
        toast('Link is in the address bar', '');
      }
    } },
  ]);
}

let demoIndex = [];
async function demoMenu(anchor) {
  if (!demoIndex.length) demoIndex = await fetchDemoIndex();
  menu(anchor, demoIndex.map((d) => ({ label: d.name, action: () => loadDemo(d.id) })));
}

let skinIndex = [];
async function skinMenu(anchor) {
  if (!skinIndex.length) skinIndex = await fetchSkinIndex();
  const cur = currentSkin()?.id;
  menu(anchor, [
    ...skinIndex.map((s) => ({ label: s.name, hint: s.tagline, active: s.id === cur, action: () => useSkin(s.id).then(() => rack.drawCables()) })),
    '-',
    { label: 'Load skin from URL…', action: async () => {
      const url = prompt('URL of a skin.json (images load relative to it):');
      if (url) await useCustomSkin(url).catch((e) => toast(e.message, 'warn'));
      rack.drawCables();
    } },
    { label: 'Load skin file…', action: () => {
      const i = h('input', { type: 'file', accept: '.json' });
      i.onchange = () => useCustomSkin(i.files[0]).then(() => rack.drawCables()).catch((e) => toast(e.message, 'warn'));
      i.click();
    } },
    { label: 'How to make a skin', action: () => window.open('skins/README.md', '_blank') },
  ]);
}

function settingsMenu(anchor) {
  const s = rack.rackSettings;
  const side = inspector.dockSide();
  menu(anchor, [
    { label: 'Code dock: bottom', active: side === 'bottom', action: () => inspector.setDock('bottom') },
    { label: 'Code dock: right', active: side === 'right', action: () => inspector.setDock('right') },
    '-',
    { label: `Cable opacity: ${Math.round(s.cableOpacity * 100)}%`, hint: 'click to cycle', action: () => {
      s.cableOpacity = s.cableOpacity <= 0.3 ? 1 : Math.round((s.cableOpacity - 0.25) * 100) / 100;
      localStorage.setItem('bonfire.rack', JSON.stringify(s));
      rack.drawCables();
    } },
    { label: `Cable snap radius: ${s.snap}px`, hint: 'click to cycle', action: () => {
      s.snap = s.snap >= 48 ? 14 : s.snap + 8;
      localStorage.setItem('bonfire.rack', JSON.stringify(s));
    } },
    { label: 'Reset zoom', action: () => rack.setZoom(1) },
    '-',
    { label: 'Version', hint: __APP_VERSION__, disabled: true, action: () => {} },
  ]);
}

function showHelp() {
  const jt = (t, label, desc) => h('li', {}, h('span', { class: `jt jt-${t}` }), h('b', {}, label), ` — ${desc}`);
  modal(h('div', { class: 'help' },
    h('h2', {}, 'How Bonfire STACK works'),
    h('p', {}, 'Every module writes a piece of Strudel code. Cables decide how the pieces join up, and the dock at the bottom shows the finished code — the exact code that is playing. Copy it or open it on strudel.cc and it runs unchanged.'),
    h('h3', {}, 'Jack colours'),
    h('ul', { class: 'jack-help' },
      jt('pattern', 'PATTERN', 'sound events: drums, voices, anything audible'),
      jt('pitch', 'PITCH', 'notes from MELODY: feed a VOICE (or play as-is)'),
      jt('rhythm', 'RHYTHM', 'structure only: plug into a VOICE / SAMPLER GATE'),
      jt('cv', 'CV', 'a slow 0–1 wave from the LFO that moves a knob for you'),
      jt('clock', 'CLOCK', 'sets how long each sequencer step lasts')),
    h('h3', {}, 'Patching'),
    h('ul', {},
      h('li', {}, 'Drag from a jack to a jack. Only matching colours light up.'),
      h('li', {}, 'Drag a cable off an input to move it; drop it in empty space to unplug. Double-click or right-click a cable to delete it.'),
      h('li', {}, 'Outputs can feed many inputs; each input takes one cable.'),
      h('li', {}, 'Drag a module by its panel to move it. Right-click a panel for duplicate / reset / delete.'),
      h('li', {}, 'Knobs & faders: drag up/down (Shift = fine), mouse wheel, or double-click to type an exact value.'),
      h('li', {}, 'Sequencer steps: right-click to cycle ×2 / ×4 rolls.')),
    h('h3', {}, 'Keys'),
    h('ul', {},
      h('li', {}, 'Space — play / stop'),
      h('li', {}, 'Ctrl+Z / Ctrl+Shift+Z — undo / redo'),
      h('li', {}, 'Delete — remove the module under the mouse · Ctrl+D — duplicate it'),
      h('li', {}, 'Ctrl+wheel — zoom the rack')),
    h('p', { class: 'fine' }, 'Free software (AGPL-3.0). Sound engine: ', h('a', { href: 'https://strudel.cc', target: '_blank' }, 'Strudel'), '. ',
      h('a', { href: SOURCE_URL, target: '_blank' }, 'Source code'), '.')), { className: 'modal-help' });
}

// ---------------- splash (doubles as the audio unlock gesture) ----------------
async function showSplash({ first = false } = {}) {
  if (!demoIndex.length) demoIndex = await fetchDemoIndex().catch(() => []);
  const hasSession = !!loadLocal();
  let dlg;
  const go = async (fn) => {
    dlg.close();
    await engine.unlockAudio(); // runs inside the click = counts as the user gesture
    await fn?.();
  };
  const cards = demoIndex.map((d) => h('button', { class: 'demo-card', onclick: () => go(() => loadDemo(d.id)) },
    h('div', { class: 'demo-cover', style: { backgroundImage: `url(${d.cover})` } }),
    h('div', { class: 'demo-name' }, d.name),
    h('div', { class: 'demo-desc' }, d.description)));
  dlg = modal(h('div', { class: 'splash' },
    h('div', { class: 'splash-hero', style: { '--hero': `url(${new URL('brand/hero.jpg', document.baseURI).href})` } },
      h('img', { class: 'splash-logo', src: 'brand/logo.png', alt: 'Bonfire STACK' }),
      h('p', { class: 'splash-tag' }, 'A modular synth rack that writes Strudel code. Patch cables, turn knobs, copy the code.'),
      h('div', { class: 'splash-actions' },
        first && hasSession ? h('button', { class: 'btn big accent', onclick: () => go() }, '🔥 CONTINUE MY RACK') : null,
        h('button', { class: `btn big ${first && hasSession ? '' : 'accent'}`, onclick: () => go(() => loadDemo('first-spark')) }, '▶ LIGHT IT UP'),
        h('button', { class: 'btn big', onclick: () => go(() => store.loadPatch(store.emptyPatch())) }, 'EMPTY RACK'))),
    h('h3', { class: 'splash-sub' }, 'OR START FROM A DEMO'),
    h('div', { class: 'demo-grid' }, cards),
    h('p', { class: 'fine' }, 'Free & open source (AGPL-3.0) · sound by ', h('a', { href: 'https://strudel.cc', target: '_blank' }, 'Strudel'),
      ' · ', h('a', { href: SOURCE_URL, target: '_blank' }, 'source'))), { className: 'modal-splash', onClose: () => engine.unlockAudio() });
}

// ---------------- keyboard ----------------
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea, [contenteditable]')) return;
  const mod = e.ctrlKey || e.metaKey;
  if (e.code === 'Space') {
    e.preventDefault();
    document.activeElement?.blur?.(); // a focused button would otherwise toggle a second time
    engine.togglePlay();
  } else if (mod && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    e.shiftKey ? store.redoChange() : store.undoChange();
  } else if (mod && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    store.redoChange();
  } else if (mod && e.key.toLowerCase() === 'd' && rack.hoveredModule()) {
    e.preventDefault();
    const r = store.duplicateModule(rack.hoveredModule());
    if (r.error) toast(r.error, 'warn');
  } else if ((e.key === 'Delete' || e.key === 'Backspace') && rack.hoveredModule()) {
    e.preventDefault();
    store.removeModule(rack.hoveredModule());
  } else if (e.key === 'Escape') {
    document.querySelectorAll('.drawer.open').forEach((d) => d.classList.remove('open'));
  }
});
window.addEventListener('resize', () => rack.drawCables());

// ---------------- boot ----------------
(async () => {
  const skinParam = new URLSearchParams(location.search).get('skin');
  await (skinParam ? useSkin(skinParam).catch(() => restoreSkin('bonfire')) : restoreSkin('bonfire'));
  const demoId = /#demo=([\w-]+)/.exec(location.hash)?.[1];
  const shared = (await patchFromHash()) ?? (demoId ? await fetchDemo(demoId).catch(() => null) : null);
  const saved = loadLocal();
  store.loadPatch(shared ?? saved ?? await fetchDemo('first-spark').catch(() => store.emptyPatch()), { record: false });
  engine.boot(); // fetch the sample maps while the splash is up
  initLocal();
  const params = new URLSearchParams(location.search);
  if (params.has('autoplay')) engine.play(); // only works where the browser allows autoplay
  if (params.has('nosplash')) return;
  if (shared) {
    const dlg = modal(h('div', { class: 'splash small' },
      h('img', { class: 'splash-logo', src: 'brand/logo.png', alt: 'Bonfire STACK' }),
      h('p', { class: 'splash-tag' }, demoId ? `Demo: “${store.getPatch().name}”` : `Someone shared a patch with you: “${store.getPatch().name}”`),
      h('button', { class: 'btn big accent', onclick: async () => { dlg.close(); await engine.play(); } }, '▶ PLAY IT')), { className: 'modal-splash' });
  } else {
    showSplash({ first: true });
  }
})();
