// Small DOM helpers shared by the UI.
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v)) sk.startsWith('--') ? el.style.setProperty(sk, sv) : (el.style[sk] = sv);
    }
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(c));
  return el;
}

export const svgNS = 'http://www.w3.org/2000/svg';
export function s(tag, attrs = {}) {
  const el = document.createElementNS(svgNS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

// ---- topbar parameter readout: the knob/fader under the pointer ----
const READOUT_IDLE = `Bonfire STACK - version: ${typeof __APP_VERSION__ === 'undefined' ? 'dev' : __APP_VERSION__}`;
export const readout = h('div', { class: 'lcd tb-readout', title: 'Value of the knob or fader under the pointer' }, READOUT_IDLE);
export const setReadout = (text) => (readout.textContent = text ?? READOUT_IDLE);

// ---- floating value tooltip ----
let tip;
export function showTip(text, x, y) {
  tip ??= document.body.appendChild(h('div', { class: 'value-tip' }));
  tip.textContent = text;
  tip.style.left = `${x}px`;
  tip.style.top = `${y}px`;
  tip.classList.add('on');
}
export const hideTip = () => tip?.classList.remove('on');

// ---- toasts ----
export function toast(msg, kind = '') {
  let host = document.querySelector('.toasts');
  host ??= document.body.appendChild(h('div', { class: 'toasts' }));
  const t = h('div', { class: `toast ${kind}` }, msg);
  host.append(t);
  setTimeout(() => t.classList.add('out'), 2600);
  setTimeout(() => t.remove(), 3100);
}

// ---- popovers (lists, menus) ----
let openPop = null;
export function closePopover() {
  openPop?.remove();
  openPop = null;
}
export function popover(anchor, content, { align = 'left', className = '' } = {}) {
  closePopover();
  const pop = h('div', { class: `popover ${className}` }, content);
  document.body.append(pop);
  const r = anchor.getBoundingClientRect();
  const pr = pop.getBoundingClientRect();
  let left = align === 'right' ? r.right - pr.width : r.left;
  let top = r.bottom + 4;
  if (top + pr.height > innerHeight - 8) top = Math.max(8, r.top - pr.height - 4);
  left = Math.min(Math.max(8, left), innerWidth - pr.width - 8);
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
  openPop = pop;
  setTimeout(() => {
    const off = (e) => {
      if (pop.contains(e.target)) return;
      closePopover();
      document.removeEventListener('pointerdown', off, true);
    };
    document.addEventListener('pointerdown', off, true);
  });
  return pop;
}

export function menu(anchor, items, opts) {
  const list = h('div', { class: 'menu' }, items.map((it) => (it === '-' ? h('hr') : h('button', {
    class: `menu-item ${it.active ? 'active' : ''}`,
    disabled: it.disabled,
    onclick: () => {
      closePopover();
      it.action();
    },
  }, it.label, it.hint ? h('span', { class: 'hint' }, it.hint) : null))));
  return popover(anchor, list, opts);
}

export function modal(content, { className = '', onClose } = {}) {
  const back = h('div', { class: 'modal-back' });
  const box = h('div', { class: `modal ${className}` }, content);
  back.append(box);
  const close = () => {
    back.remove();
    document.removeEventListener('keydown', esc);
    onClose?.();
  };
  const esc = (e) => e.key === 'Escape' && close();
  document.addEventListener('keydown', esc);
  back.addEventListener('pointerdown', (e) => e.target === back && close());
  document.body.append(back);
  return { close, box };
}
