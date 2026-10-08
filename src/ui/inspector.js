// Bottom dock: the live Strudel code, copy / open-in-strudel.cc, engine status.
import { code2hash } from '@strudel/core';
import { activeRanges } from '../core/engine.js';
import { h, toast } from './dom.js';

// Exported code (COPY / OPEN IN STRUDEL) gets a link back to the app on top and this
// patch's share link at the bottom. The dock itself shows the bare playing code.
const SITE = 'https://mehesz.net/bonfire/';

const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// `active` = [start, end] character ranges to light up (the steps playing right now).
export function highlight(code, active = []) {
  const re = /(\/\/[^\n]*)|("(?:[^"\\]|\\.)*")|('(?:[^'\\]|\\.)*')|(\.[a-zA-Z_]\w*)(?=\()|\b(const|x)\b|(\b\d+(?:\.\d+)?\b)|([a-zA-Z_]\w*)(?=\()|(=>)/g;
  const on = new Uint8Array(code.length);
  for (const [a, b] of active) on.fill(1, Math.max(0, a), Math.min(code.length, b));
  // one token, split into runs where the lit state changes
  const span = (from, to, cls) => {
    let out = '';
    for (let i = from; i < to;) {
      let j = i + 1;
      while (j < to && on[j] === on[i]) j++;
      const c = on[i] ? `${cls} tk-on`.trim() : cls;
      out += c ? `<span class="${c}">${esc(code.slice(i, j))}</span>` : esc(code.slice(i, j));
      i = j;
    }
    return out;
  };
  let out = '';
  let last = 0;
  for (const m of code.matchAll(re)) {
    out += span(last, m.index, '');
    const [t, com, dq, sq, meth, kw, numb, fn, arrow] = m;
    const cls = com ? 'tk-com' : dq ? 'tk-mini' : sq ? 'tk-str' : meth ? 'tk-meth' : kw ? 'tk-kw' : numb ? 'tk-num' : fn ? 'tk-fn' : arrow ? 'tk-kw' : '';
    out += span(m.index, m.index + t.length, cls);
    last = m.index + t.length;
  }
  return out + span(last, code.length, '');
}

export function mountInspector(host) {
  const pre = h('pre', { class: 'code' });
  const status = h('div', { class: 'insp-status' });
  const lines = h('span', { class: 'insp-lines' });
  let code = '';
  let shareLink = '';
  let litKey = '';
  let playing = false;
  let collapsed = false;
  let side = 'bottom';
  try {
    collapsed = localStorage.getItem('bonfire.inspector') === 'closed';
    side = localStorage.getItem('bonfire.dock') === 'right' ? 'right' : 'bottom';
  } catch { /* ignore */ }
  const exported = () => [`// made with Bonfire STACK: ${SITE}`, code,
    ...(shareLink ? ['', `// open this patch in Bonfire STACK: ${shareLink}`] : [])].join('\n');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(exported());
      toast('Code copied — paste it into strudel.cc');
    } catch {
      toast('Clipboard blocked by the browser', 'warn');
    }
  };
  const open = () => window.open(`https://strudel.cc/#${code2hash(exported())}`, '_blank', 'noopener');
  const toggleBtn = h('button', { class: 'insp-toggle', title: 'Show / hide code' });
  const dock = h('section', { class: 'inspector' },
    h('header', {},
      toggleBtn,
      h('span', { class: 'insp-title' }, 'STRUDEL CODE'),
      lines,
      status,
      h('div', { class: 'insp-actions' },
        h('button', { class: 'btn', onclick: copy }, 'COPY CODE'),
        h('button', { class: 'btn accent', onclick: open, title: 'Opens this exact code in the strudel.cc REPL' }, 'OPEN IN STRUDEL ↗'))),
    h('div', { class: 'insp-body' }, pre));
  // Body classes let the rack and drawers make room for the dock.
  const setCollapsed = (v) => {
    collapsed = v;
    dock.classList.toggle('collapsed', v);
    document.body.classList.toggle('insp-collapsed', v);
    toggleBtn.textContent = side === 'right' ? (v ? '◀' : '▶') : (v ? '▲' : '▼');
    try {
      localStorage.setItem('bonfire.inspector', v ? 'closed' : 'open');
    } catch { /* ignore */ }
  };
  toggleBtn.onclick = () => setCollapsed(!collapsed);
  dock.querySelector('.insp-title').onclick = () => setCollapsed(!collapsed);
  const setDock = (s) => {
    side = s;
    document.body.classList.toggle('dock-right', s === 'right');
    setCollapsed(collapsed);
    try {
      localStorage.setItem('bonfire.dock', s);
    } catch { /* ignore */ }
    window.dispatchEvent(new Event('resize')); // cables re-measure jack positions
  };
  setDock(side);
  host.append(dock);
  // light up the steps that are sounding; only re-render when the lit set changes
  const render = (ranges) => {
    const key = ranges.map((r) => r.join('-')).sort().join(',');
    if (key === litKey) return;
    litKey = key;
    pre.innerHTML = highlight(code, ranges);
  };
  const tick = () => {
    requestAnimationFrame(tick);
    if (collapsed || document.hidden) return;
    render(playing ? activeRanges(code) : []);
  };
  requestAnimationFrame(tick);
  return {
    dockSide: () => side,
    setDock,
    setShareLink(url) {
      shareLink = url;
    },
    setCode(c) {
      if (c === code) return;
      code = c;
      litKey = '';
      pre.innerHTML = highlight(c);
      lines.textContent = `${c.split('\n').length} lines`;
    },
    setStatus({ error, playing: p, loading, compileErrors = [] }) {
      playing = p;
      const err = error || compileErrors.join(' · ');
      status.className = `insp-status ${err ? 'err' : p ? 'live' : ''}`;
      status.textContent = err ? `⚠ ${err}` : loading ? 'loading sounds…' : p ? '● LIVE' : '■ STOPPED';
    },
  };
}
