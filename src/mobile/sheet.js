// Bottom sheets: the phone's menus, pickers and dialogs. One open at a time.
import { h } from '../ui/dom.js';

let open = null;

export function closeSheet() {
  open?.close();
}

// content: a node, or a function returning one (re-run by sheet.render()).
export function sheet(title, content, { onClose, className = '', actions = null } = {}) {
  closeSheet();
  const body = h('div', { class: 'm-sheet-body' });
  const box = h('div', { class: `m-sheet ${className}` },
    h('header', { class: 'm-sheet-head' },
      h('b', {}, title),
      h('button', { class: 'm-btn m-sheet-x', onclick: () => close(), 'aria-label': 'Close' }, '✕')),
    body,
    actions ? h('footer', { class: 'm-sheet-foot' }, actions) : null);
  const back = h('div', { class: 'm-sheet-back' }, box);
  back.addEventListener('click', (e) => e.target === back && close());
  const render = () => {
    const top = body.scrollTop;
    body.replaceChildren(typeof content === 'function' ? content() : content);
    body.scrollTop = top;
  };
  const self = { close, render, el: box };
  function close() {
    if (open !== self) return;
    open = null;
    back.classList.add('out');
    setTimeout(() => back.remove(), 180);
    onClose?.();
  }
  render();
  document.body.append(back);
  requestAnimationFrame(() => back.classList.add('in'));
  open = self;
  return self;
}

// A tappable list row: big target, title + optional hint, optional left adornment.
export function row({ label, hint, left, right, on, disabled, onclick, className = '' }) {
  return h('button', { class: `m-row ${on ? 'on' : ''} ${className}`, disabled, onclick },
    left ?? null,
    h('span', { class: 'm-row-text' }, h('span', { class: 'm-row-label' }, label), hint ? h('span', { class: 'm-row-hint' }, hint) : null),
    right ?? null);
}
