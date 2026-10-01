// Custom panel widgets. Each returns { el, update(params), tick(cycle, meta) }.
import { checkpoint, findModule, setParam } from '../core/store.js';
import { bjorklund } from '@strudel/core';
import { analysers } from '../core/engine.js';
import { DRUM_SOUNDS } from '../core/music.js';
import { h, hideTip, s, showTip } from './dom.js';
import { editValue, select } from './controls.js';

const stop = (e) => e.stopPropagation();
const cycleState = (v) => (v + 1) % 4;
const SUB = ['', '', '×2', '×4'];

function stepIndex(cycle, meta) {
  if (cycle == null || !meta?.dur) return -1;
  const pos = ((cycle % meta.dur) + meta.dur) % meta.dur;
  return Math.floor((pos / meta.dur) * meta.steps);
}

// SEQ-16: 2 x 8 step buttons
function steps(mod) {
  const btns = [];
  const grid = h('div', { class: 'w-steps' });
  for (let i = 0; i < 16; i++) {
    const b = h('button', { class: 'step', onpointerdown: stop, dataset: { i } }, h('span', { class: 'led' }), h('em'));
    b.addEventListener('click', () => {
      const p = findModule(mod.id).params;
      const next = [...p.steps];
      next[i] = next[i] === p.mode ? 0 : p.mode;
      setParam(mod.id, 'steps', next);
    });
    b.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const next = [...findModule(mod.id).params.steps];
      next[i] = cycleState(next[i]);
      setParam(mod.id, 'steps', next);
    });
    btns.push(b);
    grid.append(b);
  }
  return {
    el: grid,
    update(p) {
      btns.forEach((b, i) => {
        b.classList.toggle('on', p.steps[i] > 0);
        b.classList.toggle('off-len', i >= p.length);
        b.querySelector('em').textContent = SUB[p.steps[i]] ?? '';
      });
    },
    tick(cycle, meta) {
      const k = stepIndex(cycle, meta);
      btns.forEach((b, i) => b.classList.toggle('play', i === k));
    },
  };
}

// BEATS: 4 lanes x 16
function grid(mod) {
  const cells = [];
  const lanes = [];
  const el = h('div', { class: 'w-grid' });
  for (let l = 0; l < 4; l++) {
    const sel = select(mod, `lane${l}`, { label: '', options: DRUM_SOUNDS });
    lanes.push(sel);
    const row = h('div', { class: 'grid-row' }, h('div', { class: 'grid-lane' }, sel.el));
    const rowCells = [];
    for (let i = 0; i < 16; i++) {
      const c = h('button', { class: `cell ${i % 4 === 0 ? 'beat' : ''}`, onpointerdown: stop }, h('em'));
      c.addEventListener('click', () => {
        const g = structuredClone(findModule(mod.id).params.grid);
        g[l][i] = g[l][i] ? 0 : 1;
        setParam(mod.id, 'grid', g);
      });
      c.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const g = structuredClone(findModule(mod.id).params.grid);
        g[l][i] = cycleState(g[l][i]);
        setParam(mod.id, 'grid', g);
      });
      rowCells.push(c);
      row.append(c);
    }
    cells.push(rowCells);
    el.append(row);
  }
  return {
    el,
    update(p) {
      lanes.forEach((s, l) => s.update(p[`lane${l}`]));
      cells.forEach((row, l) => row.forEach((c, i) => {
        c.classList.toggle('on', p.grid[l][i] > 0);
        c.classList.toggle('off-len', i >= p.length);
        c.querySelector('em').textContent = SUB[p.grid[l][i]] ?? '';
      }));
    },
    tick(cycle, meta) {
      const k = stepIndex(cycle, meta);
      cells.forEach((row) => row.forEach((c, i) => c.classList.toggle('play', i === k)));
    },
  };
}

// MELODY: 8 columns of (degree knob, gate)
function melody(mod) {
  const cols = [];
  const el = h('div', { class: 'w-melody' });
  for (let i = 0; i < 8; i++) {
    const cap = h('div', { class: 'knob-cap' }, h('div', { class: 'knob-img' }), h('div', { class: 'knob-ptr' }));
    const num = h('div', { class: 'deg lcd' });
    const gate = h('button', { class: 'step gate', onpointerdown: stop }, h('span', { class: 'led' }));
    gate.addEventListener('click', () => {
      const g = [...findModule(mod.id).params.gates];
      g[i] = g[i] ? 0 : 1;
      setParam(mod.id, 'gates', g);
    });
    let startY = 0;
    let start = 0;
    cap.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      cap.setPointerCapture(e.pointerId);
      checkpoint();
      startY = e.clientY;
      start = findModule(mod.id).params.degrees[i];
    });
    cap.addEventListener('pointermove', (e) => {
      if (!cap.hasPointerCapture(e.pointerId)) return;
      const v = Math.max(0, Math.min(14, Math.round(start + (startY - e.clientY) / 10)));
      const d = [...findModule(mod.id).params.degrees];
      if (d[i] !== v) {
        d[i] = v;
        setParam(mod.id, 'degrees', d, { record: false });
      }
      const r = cap.getBoundingClientRect();
      showTip(`STEP ${i + 1} · DEGREE ${v}`, r.left + r.width / 2, r.top - 6);
    });
    cap.addEventListener('pointerup', (e) => {
      cap.releasePointerCapture(e.pointerId);
      hideTip();
    });
    cap.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      hideTip();
      editValue(cap, { label: `STEP ${i + 1} DEGREE`, min: 0, max: 14, step: 1, default: 0 }, findModule(mod.id).params.degrees[i], (v) => {
        const d = [...findModule(mod.id).params.degrees];
        d[i] = v;
        setParam(mod.id, 'degrees', d);
      });
    });
    cap.addEventListener('wheel', (e) => {
      e.preventDefault();
      const d = [...findModule(mod.id).params.degrees];
      d[i] = Math.max(0, Math.min(14, d[i] + (e.deltaY < 0 ? 1 : -1)));
      setParam(mod.id, 'degrees', d);
    }, { passive: false });
    const col = h('div', { class: 'mel-col' }, h('div', { class: 'knob knob-sm' }, h('div', { class: 'knob-scale' }, cap)), num, gate);
    cols.push({ col, cap, num, gate });
    el.append(col);
  }
  return {
    el,
    update(p) {
      cols.forEach((c, i) => {
        c.cap.style.setProperty('--rot', `${-135 + (p.degrees[i] / 14) * 270}deg`);
        c.num.textContent = p.gates[i] ? p.degrees[i] : '–';
        c.gate.classList.toggle('on', !!p.gates[i]);
        c.col.classList.toggle('off-len', i >= p.length);
      });
    },
    tick(cycle, meta) {
      const k = stepIndex(cycle, meta);
      cols.forEach((c, i) => c.col.classList.toggle('play', i === k));
    },
  };
}

// Same pattern Strudel plays for x(p,s,r): bjorklund, rotated by r.
export function euclidPattern(pulses, steps, rot = 0) {
  const b = bjorklund(pulses, steps).map((v) => (v ? 1 : 0));
  const r = rot % steps;
  return r ? b.slice(-r).concat(b.slice(0, -r)) : b;
}

function euclidRing(mod) {
  const svg = s('svg', { viewBox: '0 0 100 100', class: 'w-euclid' });
  let dots = [];
  return {
    el: svg,
    update(p) {
      const n = p.steps;
      const pat = euclidPattern(Math.min(p.pulses, n), n, p.rotate);
      svg.replaceChildren(s('circle', { cx: 50, cy: 50, r: 38, class: 'eu-ring' }));
      dots = pat.map((v, i) => {
        const a = (i / n) * Math.PI * 2 - Math.PI / 2;
        const d = s('circle', { cx: 50 + Math.cos(a) * 38, cy: 50 + Math.sin(a) * 38, r: v ? 6 : 3.2, class: v ? 'eu-hit' : 'eu-rest' });
        svg.append(d);
        return d;
      });
      svg.append(Object.assign(s('text', { x: 50, y: 56, class: 'eu-label' }), { textContent: `${Math.min(p.pulses, n)}/${n}` }));
    },
    tick(cycle, meta) {
      const k = stepIndex(cycle, meta);
      dots.forEach((d, i) => d.classList.toggle('play', i === k));
    },
  };
}

function bpmDisplay(mod, def) {
  const el = h('div', { class: 'lcd big bpm editable', title: 'double-click to type a tempo' });
  el.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    editValue(el, def.params.bpm, findModule(mod.id).params.bpm, (v) => setParam(mod.id, 'bpm', v));
  });
  return { el, update: (p) => (el.textContent = `${Math.round(p.bpm)}`), tick() {} };
}

const SHAPES = {
  sine: (t) => 0.5 + 0.5 * Math.sin(t * Math.PI * 2),
  tri: (t) => (t < 0.5 ? t * 2 : 2 - t * 2),
  saw: (t) => t,
  isaw: (t) => 1 - t,
  square: (t) => (t < 0.5 ? 0 : 1),
  rand: (t) => { const x = Math.sin(Math.floor(t * 8) * 12.9898) * 43758.5453; return x - Math.floor(x); },
  perlin: (t) => 0.5 + 0.35 * Math.sin(t * 6.3) * Math.cos(t * 2.1),
};

function lfoScope() {
  const c = h('canvas', { class: 'w-lfo', width: 140, height: 70 });
  const g = c.getContext('2d');
  let params = null;
  const draw = (cycle) => {
    if (!params) return;
    const f = SHAPES[params.shape] ?? SHAPES.sine;
    const col = getComputedStyle(c).getPropertyValue('--scope-line').trim() || '#2ec4d6';
    g.clearRect(0, 0, c.width, c.height);
    g.strokeStyle = col;
    g.lineWidth = 3;
    g.beginPath();
    for (let x = 0; x <= c.width; x += 2) {
      let t = (x / c.width) % 1;
      if (params.step) t = Math.floor(t * 16) / 16;
      const y = 8 + (1 - f(t)) * (c.height - 16);
      x ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke();
    if (cycle != null) {
      const t = ((cycle * params.rate) % 1 + 1) % 1;
      const tt = params.step ? Math.floor(t * 16) / 16 : t;
      g.fillStyle = col;
      g.beginPath();
      g.arc(t * c.width, 8 + (1 - f(tt)) * (c.height - 16), 6, 0, Math.PI * 2);
      g.fill();
    }
  };
  return {
    el: c,
    update(p) {
      params = p;
      draw(null);
    },
    tick: (cycle) => cycle != null && draw(cycle),
  };
}

function scope() {
  const c = h('canvas', { class: 'w-scope', width: 400, height: 200 });
  const g = c.getContext('2d');
  let buf = null;
  let idle = false;
  return {
    el: c,
    update() {},
    tick() {
      const st = analysers();
      const w = c.width;
      const ht = c.height;
      const cs = getComputedStyle(c);
      g.fillStyle = cs.getPropertyValue('--scope').trim() || '#06120f';
      g.fillRect(0, 0, w, ht);
      g.strokeStyle = 'rgba(255,255,255,0.07)';
      g.lineWidth = 1;
      for (let i = 1; i < 8; i++) {
        g.beginPath(); g.moveTo((i * w) / 8, 0); g.lineTo((i * w) / 8, ht); g.stroke();
      }
      for (let i = 1; i < 4; i++) {
        g.beginPath(); g.moveTo(0, (i * ht) / 4); g.lineTo(w, (i * ht) / 4); g.stroke();
      }
      g.strokeStyle = cs.getPropertyValue('--scope-line').trim() || '#5bff9a';
      g.lineWidth = 3;
      g.shadowColor = g.strokeStyle;
      g.shadowBlur = 8;
      g.beginPath();
      if (st) {
        buf ??= new Float32Array(st.mono.fftSize);
        st.mono.getFloatTimeDomainData(buf);
        // trigger on a rising zero crossing so the trace stands still
        let start = 0;
        for (let i = 1; i < buf.length / 2; i++) if (buf[i - 1] < 0 && buf[i] >= 0) { start = i; break; }
        const n = Math.min(buf.length - start, 1024);
        for (let i = 0; i < n; i++) {
          const x = (i / n) * w;
          const y = ht / 2 - buf[start + i] * ht * 0.45;
          i ? g.lineTo(x, y) : g.moveTo(x, y);
        }
        idle = false;
      } else if (!idle) {
        g.moveTo(0, ht / 2);
        g.lineTo(w, ht / 2);
      }
      g.stroke();
      g.shadowBlur = 0;
    },
  };
}

function meters() {
  const mk = () => {
    const segs = Array.from({ length: 12 }, (_, i) => h('i', { class: i >= 10 ? 'hot' : i >= 7 ? 'warm' : '' }));
    return { el: h('div', { class: 'meter-col' }, h('span', { class: 'clip' }), h('div', { class: 'meter-bar' }, segs.slice().reverse())), segs, clipT: 0 };
  };
  const l = mk();
  const r = mk();
  const el = h('div', { class: 'w-meters' }, l.el, r.el, h('div', { class: 'meter-lab' }, h('span', {}, 'L'), h('span', {}, 'R')));
  let buf = null;
  const level = (an) => {
    buf ??= new Float32Array(an.fftSize);
    an.getFloatTimeDomainData(buf);
    let peak = 0;
    for (const v of buf) peak = Math.max(peak, Math.abs(v));
    return peak;
  };
  const draw = (m, peak) => {
    const db = 20 * Math.log10(peak || 1e-6);
    const lit = Math.round(((db + 48) / 48) * 12);
    m.segs.forEach((sEl, i) => sEl.classList.toggle('lit', i < lit));
    if (peak >= 0.99) m.clipT = performance.now();
    m.el.querySelector('.clip').classList.toggle('on', performance.now() - m.clipT < 1000);
  };
  return {
    el,
    update() {},
    tick() {
      const st = analysers();
      draw(l, st ? level(st.left) : 0);
      draw(r, st ? level(st.right) : 0);
    },
  };
}

export const WIDGETS = { steps, grid, melody, euclidRing, bpmDisplay, lfoScope, scope, meters };
