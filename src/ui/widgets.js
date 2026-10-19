// Custom panel widgets. Each returns { el, update(params), tick(cycle, meta) }.
import { checkpoint, findModule, setParam } from '../core/store.js';
import { bjorklund } from '@strudel/core';
import { analysers } from '../core/engine.js';
import { DRUM_SOUNDS, chordNumeral } from '../core/music.js';
import { ARP_SLOTS, CHAIN_INPUTS, CHAIN_SLOTS, CHORD_MOODS, CHORD_PRESETS, CHORD_QUALITIES, CHORD_SLOTS, OCT_MAX, arpOrder, beats, chordPlan } from '../modules/sources.js';
import { FENV_PRESETS, khaozPath } from '../modules/processors.js';
import { CHOP_STEPS } from '../modules/voices.js';
import { closePopover, h, hideTip, popover, s, showTip } from './dom.js';
import { editValue, knob, select } from './controls.js';

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
  const levels = [];
  const tones = [];
  const el = h('div', { class: 'w-grid' });
  for (let l = 0; l < 4; l++) {
    const sel = select(mod, `lane${l}`, { label: '', options: DRUM_SOUNDS });
    const lvl = knob(mod, `level${l}`, beats.params[`level${l}`]);
    lanes.push(sel);
    const tone = knob(mod, `tone${l}`, beats.params[`tone${l}`]);
    levels.push(lvl);
    tones.push(tone);
    const row = h('div', { class: 'grid-row' }, h('div', { class: 'grid-lane' }, sel.el, lvl.el, tone.el));
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
      levels.forEach((k, l) => k.update(p[`level${l}`]));
      tones.forEach((k, l) => k.update(p[`tone${l}`]));
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

// One small knob editing params[key][i]: drag, wheel, or double-click to type.
// `max` may be a function (CHOPPER: it follows SLICES); `word` names the value in the tooltip.
// `onShiftEdit` (optional) takes over a shift + double-click (MELODY: type the whole line).
function degreeKnob(mod, key, i, maxOf, label, word = 'DEGREE', onShiftEdit = null) {
  const lim = () => (typeof maxOf === 'function' ? maxOf() : maxOf);
  const cap = h('div', { class: 'knob-cap' }, h('div', { class: 'knob-img' }), h('div', { class: 'knob-ptr' }));
  const set = (v, opts) => {
    const d = [...findModule(mod.id).params[key]];
    if (d[i] === v) return;
    for (let j = d.length; j < i; j++) d[j] = 0; // short arrays from older patches: no holes
    d[i] = v;
    setParam(mod.id, key, d, opts);
  };
  let startY = 0;
  let start = 0;
  cap.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    cap.setPointerCapture(e.pointerId);
    checkpoint();
    startY = e.clientY;
    start = findModule(mod.id).params[key][i] ?? 0;
  });
  cap.addEventListener('pointermove', (e) => {
    if (!cap.hasPointerCapture(e.pointerId)) return;
    const v = Math.max(0, Math.min(lim(), Math.round(start + (startY - e.clientY) / 10)));
    set(v, { record: false });
    const r = cap.getBoundingClientRect();
    showTip(`${label} · ${word} ${v}`, r.left + r.width / 2, r.top - 6);
  });
  cap.addEventListener('pointerup', (e) => {
    cap.releasePointerCapture(e.pointerId);
    hideTip();
  });
  cap.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    hideTip();
    if (e.shiftKey && onShiftEdit) return onShiftEdit(cap);
    editValue(cap, { label: `${label} ${word}`, min: 0, max: lim(), step: 1, default: 0 }, findModule(mod.id).params[key][i], (v) => set(v));
  });
  cap.addEventListener('wheel', (e) => {
    e.preventDefault();
    const v = findModule(mod.id).params[key][i] ?? 0;
    set(Math.max(0, Math.min(lim(), v + (e.deltaY < 0 ? 1 : -1))));
  }, { passive: false });
  return {
    el: h('div', { class: 'knob knob-sm' }, h('div', { class: 'knob-scale' }, cap)),
    update: (v) => cap.style.setProperty('--rot', `${-135 + (Math.min(v, lim()) / lim()) * 270}deg`),
  };
}

// MELODY: 8 columns of (degree knob, gate)
const MELODY_STEPS = 16; // two rows of 8
const MELODY_MAX = 14;

// Shift + double-click a MELODY knob: one line per step from step 1, a degree (0-14) or - for off.
// Anything else (or past 14) turns that step off; steps after the last line are left alone.
function editMelodyLines(anchor, mod) {
  const p = findModule(mod.id).params;
  const area = h('textarea', { class: 've-input ve-lines', rows: MELODY_STEPS, spellcheck: false });
  area.value = Array.from({ length: MELODY_STEPS }, (_, i) => (p.gates[i] ? p.degrees[i] ?? 0 : '-')).join('\n');
  const apply = () => {
    const lines = area.value.replace(/\s+$/, '').split('\n').slice(0, MELODY_STEPS);
    const m = findModule(mod.id);
    if (!m) return closePopover();
    const d = [...m.params.degrees];
    const g = [...m.params.gates];
    for (let j = d.length; j < lines.length; j++) d[j] = 0;
    for (let j = g.length; j < lines.length; j++) g[j] = 0;
    lines.forEach((line, i) => {
      const s = line.trim();
      const v = /^\d+$/.test(s) ? Number(s) : NaN;
      if (v <= MELODY_MAX) {
        d[i] = v;
        g[i] = 1;
      } else g[i] = 0; // keep the old degree under a rest, like the gate button does
    });
    checkpoint(); // one undo step for the whole line
    setParam(mod.id, 'degrees', d, { record: false });
    setParam(mod.id, 'gates', g, { record: false });
    closePopover();
  };
  const form = h('form', { class: 'value-edit', onsubmit: (e) => { e.preventDefault(); apply(); } },
    h('div', { class: 've-title' }, 'NOTES', h('span', {}, `0 – ${MELODY_MAX}, - = off`)),
    area,
    h('div', { class: 've-actions' }, h('button', { type: 'submit', class: 'btn accent' }, 'SET')));
  area.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePopover();
    else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); apply(); }
  });
  popover(anchor, form, { className: 'pop-value' });
  setTimeout(() => {
    area.focus();
    area.select();
  }, 0);
}

function melody(mod) {
  const cols = [];
  const el = h('div', { class: 'w-melody' });
  for (let i = 0; i < MELODY_STEPS; i++) {
    const knob = degreeKnob(mod, 'degrees', i, MELODY_MAX, `STEP ${i + 1}`, 'DEGREE', (cap) => editMelodyLines(cap, mod));
    const num = h('div', { class: 'deg lcd' });
    const gate = h('button', { class: 'step gate', onpointerdown: stop }, h('span', { class: 'led' }));
    gate.addEventListener('click', () => {
      const g = [...findModule(mod.id).params.gates];
      for (let j = g.length; j < i; j++) g[j] = 0;
      g[i] = g[i] ? 0 : 1;
      setParam(mod.id, 'gates', g);
    });
    const col = h('div', { class: 'mel-col' }, knob.el, num, gate);
    cols.push({ col, knob, num, gate });
    el.append(col);
  }
  return {
    el,
    update(p) {
      cols.forEach((c, i) => {
        c.knob.update(p.degrees[i] ?? 0);
        c.num.textContent = p.gates[i] ? p.degrees[i] ?? 0 : '–';
        c.gate.classList.toggle('on', !!p.gates[i]);
        c.col.classList.toggle('off-len', i >= p.length);
        // the second row only shows once LENGTH goes past 8, so a fresh MELODY looks like the 8-step one
        c.col.hidden = i >= 8 && p.length <= 8;
      });
    },
    tick(cycle, meta) {
      const k = stepIndex(cycle, meta);
      cols.forEach((c, i) => c.col.classList.toggle('play', i === k));
    },
  };
}

// CHOPPER: MELODY's two rows of 8, but each knob picks a slice and the button
// is a SEQ-style step: click = play / rest, right-click cycles the ×2 / ×4 rolls.
function chopper(mod) {
  const cols = [];
  const el = h('div', { class: 'w-melody w-chopper' });
  const lastSlice = () => findModule(mod.id).params.slices - 1;
  const setGate = (i, fnNext) => {
    const g = [...findModule(mod.id).params.gates];
    for (let j = g.length; j < i; j++) g[j] = 0;
    g[i] = fnNext(g[i] ?? 0);
    setParam(mod.id, 'gates', g);
  };
  for (let i = 0; i < CHOP_STEPS; i++) {
    const knob = degreeKnob(mod, 'picks', i, lastSlice, `STEP ${i + 1}`, 'SLICE');
    const num = h('div', { class: 'deg lcd' });
    const gate = h('button', { class: 'step gate', onpointerdown: stop }, h('span', { class: 'led' }), h('em'));
    gate.addEventListener('click', () => setGate(i, (v) => (v ? 0 : 1)));
    gate.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      setGate(i, cycleState);
    });
    const col = h('div', { class: 'mel-col' }, knob.el, num, gate);
    cols.push({ col, knob, num, gate });
    el.append(col);
  }
  return {
    el,
    update(p) {
      cols.forEach((c, i) => {
        const pick = Math.min(p.picks[i] ?? 0, p.slices - 1); // what actually plays
        c.knob.update(pick);
        c.num.textContent = p.gates[i] ? pick : '–';
        c.gate.classList.toggle('on', !!p.gates[i]);
        c.gate.querySelector('em').textContent = SUB[p.gates[i]] ?? '';
        c.col.classList.toggle('off-len', i >= p.length);
        c.col.hidden = i >= 8 && p.length <= 8;
      });
    },
    tick(cycle, meta) {
      const k = stepIndex(cycle, meta);
      cols.forEach((c, i) => c.col.classList.toggle('play', i === k));
    },
  };
}

// ARP: a ladder of the note order (one bar per step, height = pitch) over the
// chord slots. The playhead lights the chord and the step that are sounding.
const LADDER = { w: 240, h: 44 };
function arp(mod) {
  const ladder = s('svg', { viewBox: `0 0 ${LADDER.w} ${LADDER.h}`, class: 'arp-ladder', preserveAspectRatio: 'none' });
  const slots = [];
  const row = h('div', { class: 'arp-slots' });
  for (let i = 0; i < ARP_SLOTS; i++) {
    const knob = degreeKnob(mod, 'degrees', i, 6, `CHORD ${i + 1}`);
    const lcd = h('div', { class: 'deg lcd' });
    const col = h('div', { class: 'mel-col' }, knob.el, lcd);
    slots.push({ col, knob, lcd });
    row.append(col);
  }
  let bars = [];
  return {
    el: h('div', { class: 'w-arp' }, ladder, row),
    update(p) {
      slots.forEach((c, i) => {
        c.knob.update(p.degrees[i]);
        c.lcd.textContent = chordNumeral(p.scale, p.degrees[i]);
        c.col.classList.toggle('off-len', i >= p.chords);
      });
      const order = arpOrder(p.shape, p.range, p.mode, p.scale);
      const top = Math.max(1, ...order);
      const w = LADDER.w / order.length;
      ladder.classList.toggle('rand', p.mode === 'rand');
      bars = order.map((d, i) => {
        const bh = 6 + (d / top) * (LADDER.h - 8);
        return s('rect', { x: i * w + 1, y: LADDER.h - bh, width: Math.max(1, w - 2), height: bh, rx: Math.min(2, w / 4), class: 'arp-bar' });
      });
      ladder.replaceChildren(...bars);
    },
    tick(cycle, meta) {
      const on = cycle != null && meta?.order?.length;
      const mod1 = (v, n) => ((v % n) + n) % n;
      const ci = on ? mod1(Math.floor(cycle / meta.chordDur), meta.roots.length) : -1;
      const t = on && meta.retrig ? mod1(cycle, meta.chordDur) : cycle;
      const si = on && !meta.rand ? mod1(Math.floor(t / meta.step + 1e-6), meta.order.length) : -1;
      slots.forEach((c, i) => c.col.classList.toggle('play', i === ci));
      bars.forEach((b, i) => b.classList.toggle('play', i === si));
    },
  };
}

// CHORDS: 8 slots of (numeral, degree knob, chord name). Click a name to force
// the next chord type, right-click for the previous one.
function chords(mod) {
  const el = h('div', { class: 'w-chords' });
  const slots = [];
  const bump = (i, by) => {
    const q = [...findModule(mod.id).params.quals];
    const n = CHORD_QUALITIES.length;
    q[i] = CHORD_QUALITIES[(CHORD_QUALITIES.findIndex((o) => o.v === q[i]) + by + n) % n].v;
    setParam(mod.id, 'quals', q);
  };
  for (let i = 0; i < CHORD_SLOTS; i++) {
    const num = h('div', { class: 'ch-num' });
    const knob = degreeKnob(mod, 'degrees', i, 6, `CHORD ${i + 1}`);
    const name = h('button', { class: 'lcd ch-name', onpointerdown: stop }, h('b'), h('i'));
    name.addEventListener('click', () => bump(i, 1));
    name.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      bump(i, -1);
    });
    const col = h('div', { class: 'mel-col' }, num, knob.el, name);
    slots.push({ col, num, knob, name });
    el.append(col);
  }
  return {
    el,
    update(p) {
      // plan every slot so the ones past LENGTH still show their chord
      const plan = chordPlan({ ...p, length: CHORD_SLOTS });
      slots.forEach((c, i) => {
        c.knob.update(p.degrees[i]);
        c.num.textContent = plan[i].numeral;
        c.name.querySelector('b').textContent = plan[i].name;
        const q = CHORD_QUALITIES.find((o) => o.v === p.quals[i]) ?? CHORD_QUALITIES[0];
        c.name.querySelector('i').textContent = q.l;
        c.name.classList.toggle('fixed', q.v !== 'auto');
        c.col.classList.toggle('off-len', i >= p.length);
      });
    },
    tick(cycle, meta) {
      const k = stepIndex(cycle, meta);
      slots.forEach((c, i) => c.col.classList.toggle('play', i === k));
    },
  };
}

// CHORDS: load a progression (preset or mood) as one undo step. ROOT stays.
function loadProgression(mod, pr, extra = {}) {
  const degrees = [...findModule(mod.id).params.degrees];
  const quals = Array(CHORD_SLOTS).fill('auto');
  pr.d.forEach((d, i) => { degrees[i] = d; quals[i] = pr.q?.[i] ?? 'auto'; });
  checkpoint();
  for (const [k, v] of Object.entries({ ...extra, scale: pr.scale, degrees, quals, length: pr.d.length })) {
    setParam(mod.id, k, v, { record: false });
  }
}

// CHORDS ADVANCED: PRESETS loads a famous progression.
function chordPresets(mod) {
  const disp = h('button', { class: 'lcd sel-disp', onpointerdown: stop }, 'LOAD…');
  disp.addEventListener('click', () => {
    const list = h('div', { class: 'pick-list' }, CHORD_PRESETS.map((pr) => h('button', {
      class: 'pick',
      onclick: () => {
        closePopover();
        loadProgression(mod, pr);
      },
    }, pr.l)));
    popover(disp, list, { className: 'pop-select' });
  });
  return {
    el: h('div', { class: 'ctl select ch-presets' }, h('div', { class: 'sel-body' }, disp), h('label', {}, 'PRESETS')),
    update() {},
    tick() {},
  };
}

// CHORDS BASIC: mood buttons + DICE. A mood loads one of its progressions at
// random; DICE rolls a different one from the same mood.
function chordMoods(mod) {
  const roll = (mood) => {
    const m = CHORD_MOODS.find((x) => x.v === mood) ?? CHORD_MOODS[0];
    const p = findModule(mod.id).params;
    const same = (pr) => pr.scale === p.scale && pr.d.length === p.length && pr.d.every((d, i) => d === p.degrees[i]);
    const pool = m.p.filter((pr) => !same(pr));
    const pr = pool[Math.floor(Math.random() * pool.length)] ?? m.p[0];
    loadProgression(mod, pr, { mood: m.v, size: m.size ?? 'triad' });
  };
  const btns = CHORD_MOODS.map((m) => h('button', { class: 'step ch-mood', onpointerdown: stop, onclick: () => roll(m.v) }, h('b', {}, m.l)));
  const dice = h('button', { class: 'step ch-mood ch-dice', onpointerdown: stop, onclick: () => roll(findModule(mod.id).params.mood) }, h('b', {}, '⚄ DICE'));
  return {
    el: h('div', { class: 'w-moods' }, ...btns, dice),
    update(p) {
      btns.forEach((b, i) => b.classList.toggle('on', CHORD_MOODS[i].v === p.mood));
    },
    tick() {},
  };
}

// FILTER ENV: SHAPE picker, styled like a select. Picking (or ‹ ›) loads a shape as one
// undo step; DICE rolls a random one. Shows CUSTOM once the knobs no longer match a shape.
const FENV_KEYS = ['open', 'swell', 'snap', 'hold'];
function fenvPresets(mod) {
  const load = (v, vals) => {
    checkpoint();
    for (const [k, x] of Object.entries({ ...vals, preset: v })) setParam(mod.id, k, x, { record: false });
  };
  const r = (lo, hi) => Number((lo + Math.random() * (hi - lo)).toFixed(2));
  const dice = () => load('', {
    open: r(1.5, 5),
    swell: Math.random() < 0.7 ? r(0, 0.08) : r(0.1, 0.8),
    snap: Number((0.08 * 10 ** Math.random()).toFixed(2)),
    hold: Math.random() < 0.4 ? 0 : r(0.1, 0.6),
  });
  const pick = (pr) => load(pr.v, Object.fromEntries(FENV_KEYS.map((k) => [k, pr[k]])));
  const step = (d) => {
    const i = FENV_PRESETS.findIndex((pr) => pr.v === findModule(mod.id).params.preset);
    pick(FENV_PRESETS[(i + d + FENV_PRESETS.length) % FENV_PRESETS.length]);
  };
  const disp = h('button', { class: 'lcd sel-disp', onpointerdown: stop });
  disp.addEventListener('click', () => {
    const cur = findModule(mod.id).params.preset;
    const item = (l, cls, fn) => h('button', { class: `pick ${cls}`, onclick: () => { closePopover(); fn(); } }, l);
    const list = h('div', { class: 'pick-list' },
      FENV_PRESETS.map((pr) => item(pr.l, pr.v === cur ? 'active' : '', () => pick(pr))),
      item('⚄ DICE', 'fe-dice', dice));
    popover(disp, list, { className: 'pop-select' });
  });
  const arrow = (d, t) => h('button', { class: 'sel-arrow', onpointerdown: stop, onclick: () => step(d) }, t);
  return {
    el: h('div', { class: 'ctl select fe-shape' }, h('div', { class: 'sel-body' }, arrow(-1, '‹'), disp, arrow(1, '›')), h('label', {}, 'SHAPE')),
    update(p) {
      const pr = FENV_PRESETS.find((x) => x.v === p.preset);
      disp.textContent = pr && FENV_KEYS.every((k) => Math.abs(pr[k] - p[k]) < 0.005) ? pr.l : 'CUSTOM';
    },
    tick() {},
  };
}

// FILTER ENV: draws the envelope one note makes, in octaves above the resting cutoff
// (height = OPEN out of 6), over a fixed 1.6 s window so fast and slow shapes look different.
// The dashed line is a held note ending (0.4 s); after it the filter closes at SNAP speed.
function fenvScope() {
  const c = h('canvas', { class: 'w-fenv-scope', width: 300, height: 104 });
  const g = c.getContext('2d');
  const WIN = 1.6, NOTE = 0.4, PAD = 8;
  let raf = 0;
  const draw = (p) => {
    const col = getComputedStyle(c).getPropertyValue('--scope-line').trim() || '#2ec4d6';
    const W = c.width, H = c.height;
    const X = (t) => (t / WIN) * W;
    const Y = (oct) => H - PAD - (Math.min(oct, 6) / 6) * (H - 2 * PAD);
    // superdough moves the cutoff between rest and rest*2^OPEN; HOLD is a share of that range in Hz
    const sus = Math.log2(1 + (2 ** p.open - 1) * p.hold);
    const atk = Math.max(p.swell, 0.001);
    // a SWELL longer than the note lets go before it reaches the top
    const pts = atk < NOTE ? [[0, 0], [atk, p.open]] : [[0, 0], [NOTE, p.open * (NOTE / atk)]];
    if (atk < NOTE) {
      const dEnd = Math.min(atk + p.snap, NOTE);
      const lv = p.open + (sus - p.open) * ((dEnd - atk) / p.snap);
      pts.push([dEnd, lv], [NOTE, lv]);
    }
    const end = pts[pts.length - 1];
    if (p.hold > 0.01) pts.push([NOTE + p.snap, 0]);
    else pts.push([end[0] + 0.01, 0]);
    pts.push([WIN, 0]);
    g.clearRect(0, 0, W, H);
    g.strokeStyle = col;
    g.globalAlpha = 0.35;
    g.lineWidth = 2;
    g.setLineDash([5, 5]);
    g.beginPath();
    g.moveTo(X(NOTE), 4);
    g.lineTo(X(NOTE), H - 4);
    g.stroke();
    g.setLineDash([]);
    g.globalAlpha = 1;
    g.lineWidth = 3;
    g.lineJoin = 'round';
    g.beginPath();
    pts.forEach(([t, v], i) => (i ? g.lineTo(X(t), Y(v)) : g.moveTo(X(t), Y(v))));
    g.stroke();
  };
  return {
    el: c,
    // next frame, so the canvas is on the panel and reads the skin's --scope-line
    update(p) {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => draw(p));
    },
    tick() {},
  };
}

// CHAIN: 4 x 8 song slots; click steps forward through A-H and rest, right-click back
function chain(mod) {
  const n = CHAIN_INPUTS.length + 1; // the letters, then rest
  const btns = [];
  const el = h('div', { class: 'w-chain' });
  const bump = (i, by) => {
    const next = [...findModule(mod.id).params.order];
    const cur = next[i] < 0 ? n - 1 : next[i];
    const v = (cur + by + n) % n;
    next[i] = v === n - 1 ? -1 : v;
    setParam(mod.id, 'order', next);
  };
  for (let i = 0; i < CHAIN_SLOTS; i++) {
    const b = h('button', { class: `step slot ${i % 8 === 4 ? 'bar' : ''}`, onpointerdown: stop }, h('b'));
    b.addEventListener('click', () => bump(i, 1));
    b.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      bump(i, -1);
    });
    btns.push(b);
    el.append(b);
  }
  return {
    el,
    update(p) {
      btns.forEach((b, i) => {
        const v = p.order[i];
        b.classList.toggle('on', v >= 0);
        b.classList.toggle('off-len', i >= p.length);
        b.querySelector('b').textContent = v >= 0 ? CHAIN_INPUTS[v].toUpperCase() : '·';
      });
    },
    tick(cycle, meta) {
      const k = stepIndex(cycle, meta);
      btns.forEach((b, i) => b.classList.toggle('play', i === k));
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

// OCTAVE: big LCD with the shift in octaves. The DOWN / UP push buttons arrive as actions;
// double-click the screen to go back to 0.
function octaveShift(mod) {
  const el = h('div', { class: 'lcd big oct editable', title: 'double-click to reset to 0' });
  const set = (v) => {
    const m = findModule(mod.id);
    if (!m) return;
    const next = Math.max(-OCT_MAX, Math.min(OCT_MAX, v));
    if (next !== (m.params.oct ?? 0)) setParam(mod.id, 'oct', next);
  };
  el.addEventListener('dblclick', (e) => { e.stopPropagation(); set(0); });
  return {
    el,
    update: (p) => { const v = p.oct ?? 0; el.textContent = v > 0 ? `+${v}` : String(v); },
    action: (spec) => set((findModule(mod.id)?.params.oct ?? 0) + (spec === 'up' ? 1 : -1)),
    tick() {},
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

// KHAOZ: the butterfly (x against z) with a dot riding the current step; COLOR tints it.
// DICE (a panel action) rolls a new seed.
function khaozScope(mod) {
  const c = h('canvas', { class: 'w-khaoz', width: 260, height: 150 });
  const g = c.getContext('2d');
  let path = null;
  let col = '#2ec4d6';
  const draw = (k) => {
    if (!path) return;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of path.trail) {
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
    }
    const sx = (x) => 10 + ((x - x0) / (x1 - x0 || 1)) * (c.width - 20);
    const sz = (z) => c.height - 10 - ((z - z0) / (z1 - z0 || 1)) * (c.height - 20);
    g.clearRect(0, 0, c.width, c.height);
    g.strokeStyle = col;
    g.globalAlpha = 0.75;
    g.lineWidth = 1.5;
    g.beginPath();
    path.trail.forEach(([x, z], i) => (i ? g.lineTo(sx(x), sz(z)) : g.moveTo(sx(x), sz(z))));
    g.stroke();
    g.globalAlpha = 1;
    if (k >= 0) {
      const [x, z] = path.trail[Math.min(path.trail.length - 1, Math.round(((k + 1) * path.trail.length) / path.steps) - 1)];
      g.fillStyle = col;
      g.shadowColor = col;
      g.shadowBlur = 10;
      g.beginPath();
      g.arc(sx(x), sz(z), 5, 0, Math.PI * 2);
      g.fill();
      g.shadowBlur = 0;
    }
  };
  return {
    el: c,
    update(p) {
      path = khaozPath(p);
      col = p.color || getComputedStyle(c).getPropertyValue('--scope-line').trim() || '#2ec4d6';
      draw(-1);
    },
    tick(cycle, meta) {
      if (cycle != null) draw(stepIndex(cycle, meta));
    },
    action(id) {
      if (id !== 'dice') return;
      checkpoint();
      setParam(mod.id, 'seed', 1 + Math.floor(Math.random() * 1e6));
    },
  };
}

// OUTPUT scope: five looks (STYLE knob), optional COLOR override, FULL = fullscreen,
// BACK = drawn big behind the rack (see-through, click-through) while you keep patching.
const LOG_LO = Math.log(30);
const LOG_HI = Math.log(16000);
let backdropOn = false; // sticky across rebuilds (demo load), so a fresh OUTPUT goes straight back up
const freqBin = (an, f) => Math.min(an.frequencyBinCount - 1, Math.round((f / (an.context.sampleRate / 2)) * an.frequencyBinCount));

function scope() {
  const c = h('canvas', { class: 'w-scope', width: 400, height: 156 });
  const wrap = h('div', { class: 'w-scope-wrap' }, c, h('div', { class: 'scope-hint' }, 'click or Esc to exit'));
  const g = c.getContext('2d');
  const bufs = {};
  let style = 'trace';
  let colour = '';
  let peaks = [];
  let spin = 0;
  let gain = 1; // ORBIT / HALO auto-gain, so quiet mixes still fill the screen
  let fresh = true; // repaint the background fully on the next frame
  let fake = null; // { parent, next } when faking fullscreen (iPhone has no element fullscreen)
  const hold = h('div', { class: 'scope-hold' }, 'BACKDROP'); // keeps the panel's shape while the scope is on the stage
  let watch = 0;

  const isFull = () => document.fullscreenElement === wrap || !!fake;
  const isBack = () => hold.isConnected && wrap.classList.contains('back');
  const lightBack = (on) => hold.closest('.module')?.classList.toggle('scope-back', on);
  const toBack = () => {
    const stage = document.querySelector('.stage');
    if (!stage || !wrap.isConnected || isFull()) return;
    wrap.replaceWith(hold);
    stage.prepend(wrap); // after .stage::before (the backdrop art), before .rack-scroll
    wrap.classList.add('back');
    lightBack(true);
    fresh = true;
    // this OUTPUT got deleted or rebuilt: take the stranded scope off the stage
    watch = setInterval(() => !hold.isConnected && fromBack(), 500);
  };
  const fromBack = () => {
    clearInterval(watch);
    if (isFull()) exit();
    lightBack(false);
    wrap.classList.remove('back');
    hold.isConnected ? hold.replaceWith(wrap) : wrap.remove();
    fresh = true;
  };
  const enter = () => {
    if (wrap.requestFullscreen) {
      wrap.requestFullscreen().catch(() => {});
    } else {
      fake = { parent: wrap.parentNode, next: wrap.nextSibling };
      document.body.append(wrap);
      wrap.classList.add('full');
    }
  };
  const exit = () => {
    if (document.fullscreenElement === wrap) document.exitFullscreen();
    if (fake) {
      fake.parent.insertBefore(wrap, fake.next);
      wrap.classList.remove('full');
      fake = null;
      fresh = true;
    }
  };
  document.addEventListener('fullscreenchange', () => (fresh = true));
  wrap.addEventListener('pointerdown', (e) => isFull() && e.stopPropagation());
  wrap.addEventListener('click', () => isFull() && exit());

  const time = (an, key) => {
    bufs[key] ??= new Float32Array(an.fftSize);
    an.getFloatTimeDomainData(bufs[key]);
    return bufs[key];
  };
  const freq = (an) => {
    bufs.f ??= new Uint8Array(an.frequencyBinCount);
    an.getByteFrequencyData(bufs.f);
    return bufs.f;
  };
  const autoGain = (buf) => {
    let peak = 0;
    for (let i = 0; i < buf.length; i += 4) peak = Math.max(peak, Math.abs(buf[i]));
    const want = 0.9 / Math.max(peak, 0.08);
    gain += (want - gain) * (want < gain ? 0.3 : 0.04);
    return gain;
  };
  // rising zero crossing, so periodic waves stand still
  const trigger = (buf) => {
    for (let i = 1; i < buf.length / 2; i++) if (buf[i - 1] < 0 && buf[i] >= 0) return i;
    return 0;
  };
  // energy of the log-spaced band [t0, t1) of 30 Hz..16 kHz, 0..1
  const band = (an, f, t0, t1) => {
    const a = freqBin(an, Math.exp(LOG_LO + (LOG_HI - LOG_LO) * t0));
    const b = Math.max(a + 1, freqBin(an, Math.exp(LOG_LO + (LOG_HI - LOG_LO) * t1)));
    let m = 0;
    for (let i = a; i < b; i++) m = Math.max(m, f[i]);
    return m / 255;
  };

  const fit = () => {
    const full = isFull() || isBack();
    const dpr = full ? Math.min(2, window.devicePixelRatio || 1) : 1;
    const w = full ? Math.round(wrap.clientWidth * dpr) : 400;
    const ht = full ? Math.round(wrap.clientHeight * dpr) : 156;
    if (w && ht && (c.width !== w || c.height !== ht)) {
      c.width = w;
      c.height = ht;
      fresh = true;
    }
  };

  const STYLES = {
    // classic triggered waveform over a graticule
    trace(st, w, ht, k, bg) {
      g.fillStyle = bg;
      g.fillRect(0, 0, w, ht);
      g.globalAlpha = 0.12;
      g.lineWidth = k;
      for (let i = 1; i < 8; i++) {
        g.beginPath(); g.moveTo((i * w) / 8, 0); g.lineTo((i * w) / 8, ht); g.stroke();
      }
      for (let i = 1; i < 4; i++) {
        g.beginPath(); g.moveTo(0, (i * ht) / 4); g.lineTo(w, (i * ht) / 4); g.stroke();
      }
      g.globalAlpha = 1;
      g.lineWidth = 3 * k;
      g.shadowBlur = 8 * k;
      g.beginPath();
      if (st) {
        const buf = time(st.mono, 'm');
        const start = trigger(buf);
        const n = Math.min(buf.length - start, 1024);
        for (let i = 0; i < n; i++) {
          const x = (i / n) * w;
          const y = ht / 2 - buf[start + i] * ht * 0.45;
          i ? g.lineTo(x, y) : g.moveTo(x, y);
        }
      } else {
        g.moveTo(0, ht / 2);
        g.lineTo(w, ht / 2);
      }
      g.stroke();
    },
    // phosphor X/Y: signal against itself a few samples later, with afterglow
    orbit(st, w, ht, k, bg) {
      g.globalAlpha = 0.18;
      g.fillStyle = bg;
      g.fillRect(0, 0, w, ht);
      g.globalAlpha = 1;
      if (!st) return;
      const buf = time(st.mono, 'm');
      const lag = 90;
      const r = Math.min(w, ht) * 0.45 * autoGain(buf);
      g.lineWidth = 1.4 * k;
      g.shadowBlur = 6 * k;
      g.globalAlpha = 0.85;
      g.beginPath();
      for (let i = 0; i < buf.length - lag; i += 2) {
        const x = w / 2 + (buf[i] - buf[i + lag]) * r * 0.75 * (w / ht > 1.4 ? 1.6 : 1);
        const y = ht / 2 - (buf[i] + buf[i + lag]) * r * 0.5;
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.stroke();
      g.globalAlpha = 1;
    },
    // log-spaced spectrum analyser with falling peak caps
    bars(st, w, ht, k, bg, col) {
      g.fillStyle = bg;
      g.fillRect(0, 0, w, ht);
      g.fillStyle = col;
      const n = Math.max(24, Math.min(96, Math.round(w / (8 * k))));
      if (peaks.length !== n) peaks = new Array(n).fill(0);
      const f = st ? freq(st.mono) : null;
      const bw = w / n;
      const cap = 2 * k;
      for (let i = 0; i < n; i++) {
        const v = f ? band(st.mono, f, i / n, (i + 1) / n) : 0;
        peaks[i] = Math.max(v, peaks[i] - 0.012);
        const bh = v * (ht - cap * 3);
        const x = i * bw + bw * 0.12;
        g.globalAlpha = 0.35 + 0.65 * v;
        g.fillRect(x, ht - bh, bw * 0.76, bh);
        g.globalAlpha = 1;
        if (peaks[i] > 0.01) g.fillRect(x, ht - peaks[i] * (ht - cap * 3) - cap * 2, bw * 0.76, cap);
      }
    },
    // waveform wrapped around a slowly turning ring, mirrored inside
    halo(st, w, ht, k, bg) {
      g.globalAlpha = 0.3;
      g.fillStyle = bg;
      g.fillRect(0, 0, w, ht);
      g.globalAlpha = 1;
      const buf = st ? time(st.mono, 'm') : null;
      const r0 = Math.min(w, ht) * 0.27;
      const amp = Math.min(w, ht) * 0.2 * (buf ? autoGain(buf) : 1);
      const start = buf ? trigger(buf) : 0;
      const n = 360;
      spin += 0.004;
      g.lineWidth = 2.2 * k;
      g.shadowBlur = 12 * k;
      for (const dir of [1, -0.55]) {
        g.beginPath();
        for (let i = 0; i <= n; i++) {
          const v = buf ? buf[start + (i % n) * 2] : 0;
          const a = (i / n) * Math.PI * 2 + spin;
          const r = r0 + v * amp * dir;
          const x = w / 2 + Math.cos(a) * r;
          const y = ht / 2 + Math.sin(a) * r;
          i ? g.lineTo(x, y) : g.moveTo(x, y);
        }
        g.globalAlpha = dir > 0 ? 1 : 0.5;
        g.stroke();
      }
      g.globalAlpha = 1;
    },
    // scrolling spectrogram: low notes at the bottom, time flows left
    fall(st, w, ht, k, bg, col) {
      const sw = Math.max(1, Math.round(2 * k));
      if (fresh) {
        g.fillStyle = bg;
        g.fillRect(0, 0, w, ht);
      }
      g.drawImage(c, sw, 0, w - sw, ht, 0, 0, w - sw, ht);
      g.fillStyle = bg;
      g.fillRect(w - sw, 0, sw, ht);
      if (!st) return;
      const f = freq(st.mono);
      const rows = Math.min(160, Math.round(ht / (2 * k)));
      const rh = ht / rows;
      g.fillStyle = col;
      for (let i = 0; i < rows; i++) {
        const v = band(st.mono, f, i / rows, (i + 1) / rows);
        if (v < 0.04) continue;
        g.globalAlpha = v * v;
        g.fillRect(w - sw, ht - (i + 1) * rh, sw, rh + 0.5);
      }
      g.globalAlpha = 1;
    },
  };

  return {
    el: wrap,
    update(p) {
      if (p.style !== style || p.color !== colour) fresh = true;
      style = p.style;
      colour = p.color;
    },
    action(id) {
      if (id === 'full') isFull() ? exit() : enter();
      if (id === 'back') {
        backdropOn = !isBack();
        backdropOn ? toBack() : fromBack();
      }
    },
    tick() {
      if (backdropOn && !isBack() && !isFull()) toBack();
      fit();
      const st = analysers();
      const w = c.width;
      const ht = c.height;
      const k = Math.max(1, ht / 156);
      const cs = getComputedStyle(c);
      const bg = cs.getPropertyValue('--scope').trim() || '#06120f';
      const col = colour || cs.getPropertyValue('--scope-line').trim() || '#5bff9a';
      if (fresh && style !== 'fall') {
        g.fillStyle = bg;
        g.fillRect(0, 0, w, ht);
      }
      g.strokeStyle = g.fillStyle = g.shadowColor = col;
      g.save();
      (STYLES[style] ?? STYLES.trace)(st, w, ht, k, bg, col);
      g.restore();
      fresh = false;
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

// TAPE: two reels turning with the transport, tape running past three heads.
// Shorter TIME = faster tape, as on a real tape echo; active heads glow and
// pulse once per echo.
const DECK = { w: 212, h: 96, reelY: 34, reelL: 40, reelR: 172, pack: 20, tapeY: 82, heads: [76, 106, 136] };

function tapeDeck() {
  const { w, h: ht, reelY, reelL, reelR, pack, tapeY, heads } = DECK;
  const path = `M ${reelL} ${reelY + pack} L ${heads[0] - 14} ${tapeY} L ${heads[2] + 14} ${tapeY} L ${reelR} ${reelY + pack}`;
  const tape = s('svg', { class: 'tape-path', viewBox: `0 0 ${w} ${ht}`, width: w, height: ht });
  tape.append(s('path', { d: path, class: 'tape-band' }));
  const flow = s('path', { d: path, class: 'tape-flow' });
  tape.append(flow);
  const reel = (x) => h('img', { class: 'tape-reel', src: 'brand/tape-reel.png', alt: '', draggable: 'false', style: { left: `${x - 31}px`, top: `${reelY - 31}px` } });
  const reels = [reel(reelL), reel(reelR)];
  const glows = [];
  const headEls = heads.map((x, i) => {
    const glow = h('span', { class: 'tape-glow' });
    glows.push(glow);
    return h('div', { class: 'tape-head', style: { left: `${x - 10}px` } }, glow, h('img', { src: 'brand/tape-head.png', alt: '', draggable: 'false' }), h('em', {}, i + 1));
  });
  const el = h('div', { class: 'w-tape' }, tape, ...reels, ...headEls);
  let time = 3 / 16;
  let active = [1];
  let last = 0;
  return {
    el,
    update(p) {
      time = p.time;
      active = String(p.heads).split('+').map(Number);
      headEls.forEach((hd, i) => hd.classList.toggle('on', active.includes(i + 1)));
    },
    tick(cycle) {
      if (cycle == null) cycle = last;
      last = cycle;
      const revs = cycle * (0.125 / time);
      const deg = (revs * 360) % 360;
      for (const r of reels) r.style.transform = `rotate(${deg}deg)`;
      flow.style.strokeDashoffset = String(-(revs * 2 * Math.PI * pack) % 24);
      glows.forEach((g, i) => {
        const span = time * (i + 1);
        const ph = ((cycle % span) + span) % span / span;
        g.style.opacity = active.includes(i + 1) ? String(0.35 + 0.65 * (1 - ph) ** 3) : '0';
      });
    },
  };
}

export const WIDGETS = { steps, grid, melody, chopper, arp, chords, chordPresets, chordMoods, fenvPresets, fenvScope, chain, euclidRing, octaveShift, bpmDisplay, lfoScope, khaozScope, scope, meters, tapeDeck };
