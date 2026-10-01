// Bottom dock: the live Strudel code, copy / open-in-strudel.cc, engine status.
import { code2hash } from '@strudel/core';
import { h, toast } from './dom.js';

const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function highlight(code) {
  const re = /(\/\/[^\n]*)|("(?:[^"\\]|\\.)*")|('(?:[^'\\]|\\.)*')|(\.[a-zA-Z_]\w*)(?=\()|\b(const|x)\b|(\b\d+(?:\.\d+)?\b)|([a-zA-Z_]\w*)(?=\()|(=>)/g;
  let out = '';
  let last = 0;
  for (const m of code.matchAll(re)) {
    out += esc(code.slice(last, m.index));
    const [t, com, dq, sq, meth, kw, numb, fn, arrow] = m;
    const cls = com ? 'tk-com' : dq ? 'tk-mini' : sq ? 'tk-str' : meth ? 'tk-meth' : kw ? 'tk-kw' : numb ? 'tk-num' : fn ? 'tk-fn' : arrow ? 'tk-kw' : '';
    out += `<span class="${cls}">${esc(t)}</span>`;
    last = m.index + t.length;
  }
  return out + esc(code.slice(last));
}

export function mountInspector(host) {
  const pre = h('pre', { class: 'code' });
  const status = h('div', { class: 'insp-status' });
  const lines = h('span', { class: 'insp-lines' });
  let code = '';
  let collapsed = false;
  let side = 'bottom';
  try {
    collapsed = localStorage.getItem('bonfire.inspector') === 'closed';
    side = localStorage.getItem('bonfire.dock') === 'right' ? 'right' : 'bottom';
  } catch { /* ignore */ }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      toast('Code copied — paste it into strudel.cc');
    } catch {
      toast('Clipboard blocked by the browser', 'warn');
    }
  };
  const open = () => window.open(`https://strudel.cc/#${code2hash(code)}`, '_blank', 'noopener');
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
  return {
    dockSide: () => side,
    setDock,
    setCode(c) {
      if (c === code) return;
      code = c;
      pre.innerHTML = highlight(c);
      lines.textContent = `${c.split('\n').length} lines`;
    },
    setStatus({ error, playing, loading, compileErrors = [] }) {
      const err = error || compileErrors.join(' · ');
      status.className = `insp-status ${err ? 'err' : playing ? 'live' : ''}`;
      status.textContent = err ? `⚠ ${err}` : loading ? 'loading sounds…' : playing ? '● LIVE' : '■ STOPPED';
    },
  };
}
