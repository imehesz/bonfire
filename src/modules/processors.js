// Pattern processors: VANDALIZER, FILTER, FX, LFO, MIXER, OUTPUT.
import { fn, ident, lambda, num } from '../core/expr.js';
import { RATES, rated, setIf } from './helpers.js';

const SOMETIMES = {
  fast: { l: 'FAST', f: (x) => x.call('fast', num(2)) },
  ply: { l: 'PLY', f: (x) => x.call('ply', num(2)) },
  rev: { l: 'REV', f: (x) => x.call('rev') },
  jux: { l: 'JUX', f: (x) => x.call('jux', ident('rev')) },
  up: { l: 'OCT↑', f: (x) => x.call('speed', num(2)) },
  down: { l: 'OCT↓', f: (x) => x.call('speed', num(0.5)) },
  crush: { l: 'CRUSH', f: (x) => x.call('crush', num(4)) },
  verb: { l: 'VERB', f: (x) => x.call('room', num(0.9)) },
};

export const vandal = {
  type: 'vandal',
  name: 'VANDALIZER',
  title: 'Strudel Vandalizer',
  category: 'Mangle',
  hp: 14,
  description: 'Breaks patterns on purpose. DEGRADE drops random events, SOMETIMES applies the chosen trick to a share of them, CHOP cuts each event into pieces, RATE speeds the whole thing up or down. CV modulates DEGRADE.',
  params: {
    degrade: { kind: 'fader', label: 'DEGRADE', min: 0, max: 1, default: 0, structural: true },
    sometimes: { kind: 'fader', label: 'SOMETIMES', min: 0, max: 1, default: 0, structural: true },
    trick: { kind: 'rotary', label: 'TRICK', options: Object.entries(SOMETIMES).map(([v, o]) => ({ v, l: o.l })), default: 'fast', structural: true },
    chop: { kind: 'rotary', label: 'CHOP', options: [1, 2, 4, 8, 16, 32].map((v) => ({ v, l: v === 1 ? 'OFF' : String(v) })), default: 1, structural: true },
    rate: { kind: 'rotary', label: 'RATE', options: RATES, default: 1, structural: true },
  },
  inputs: { in: { type: 'pattern', label: 'IN' }, cv: { type: 'cv', label: 'CV' } },
  outputs: { out: { type: 'pattern', label: 'OUT' } },
  layout: [['degrade', 'sometimes'], ['trick'], ['chop', 'rate'], ['in:in', 'in:cv', 'out:out']],
  compile(ctx) {
    let e = ctx.in('in');
    if (!e) return { out: null };
    const p = ctx.p;
    e = e.callIf(p.chop > 1, 'chop', num(p.chop));
    const cv = ctx.in('cv');
    if (cv) e = e.call('degradeBy', cv.call('range', num(0), num(p.degrade || 1, 2)));
    else e = e.callIf(p.degrade > 0.005, 'degradeBy', num(p.degrade, 2));
    if (p.sometimes > 0.005) e = e.call('sometimesBy', num(p.sometimes, 2), lambda(SOMETIMES[p.trick].f));
    return { out: rated(e, p.rate) };
  },
};

const FILTERS = { lp: ['lpf', 'lpq'], hp: ['hpf', 'hpq'], bp: ['bpf', 'bpq'] };

export const filter = {
  type: 'filter',
  name: 'FILTER',
  title: 'Filter & Tone Shaper',
  category: 'Shape',
  hp: 8,
  description: 'Lowpass darkens, highpass thins, bandpass leaves a narrow slice. RES adds a whistling peak at the cutoff. Patch an LFO into CV and AMT sets how many octaves it sweeps up.',
  params: {
    type: { kind: 'switch', label: 'TYPE', options: [{ v: 'lp', l: 'LP' }, { v: 'hp', l: 'HP' }, { v: 'bp', l: 'BP' }], default: 'lp', structural: true },
    cutoff: { kind: 'knob', label: 'CUTOFF', min: 20, max: 20000, default: 2000, curve: 'log', size: 'lg', unit: 'Hz' },
    res: { kind: 'knob', label: 'RES', min: 0, max: 20, default: 0 },
    amt: { kind: 'knob', label: 'AMT', min: 0, max: 1, default: 0.5, size: 'sm' },
  },
  inputs: { in: { type: 'pattern', label: 'IN' }, cv: { type: 'cv', label: 'CV' } },
  outputs: { out: { type: 'pattern', label: 'OUT' } },
  layout: [['type'], ['cutoff'], ['res', 'amt'], ['in:in', 'in:cv', 'out:out']],
  compile(ctx) {
    let e = ctx.in('in');
    if (!e) return { out: null };
    const [f, q] = FILTERS[ctx.p.type];
    const cut = Math.round(ctx.p.cutoff);
    const cv = ctx.in('cv');
    if (cv) {
      const top = Math.min(20000, Math.round(cut * 2 ** (ctx.p.amt * 6)));
      e = e.call(f, cv.call('rangex', num(cut), num(top)));
    } else {
      e = e.call(f, num(cut));
    }
    return { out: setIf(e, q, ctx.p.res, 0, 1) };
  },
};

const DELAY_TIMES = [
  { v: 1 / 16, l: '1/16' }, { v: 1 / 8, l: '1/8' }, { v: 3 / 16, l: '3/16' },
  { v: 1 / 4, l: '1/4' }, { v: 3 / 8, l: '3/8' }, { v: 1 / 2, l: '1/2' },
];

export const fx = {
  type: 'fx',
  name: 'EMBERS FX',
  title: 'Effects',
  category: 'Shape',
  hp: 12,
  description: 'Space and dirt. ROOM is reverb (SIZE = how big the hall), DELAY echoes in time with the clock, CRUSH lowers the bit depth, DRIVE saturates.',
  params: {
    room: { kind: 'knob', label: 'ROOM', min: 0, max: 1, default: 0 },
    size: { kind: 'knob', label: 'SIZE', min: 0.5, max: 10, default: 2, size: 'sm' },
    delay: { kind: 'knob', label: 'DELAY', min: 0, max: 1, default: 0 },
    time: { kind: 'rotary', label: 'TIME', options: DELAY_TIMES, default: 3 / 16, size: 'sm' },
    feedback: { kind: 'knob', label: 'FDBK', min: 0, max: 0.95, default: 0.5, size: 'sm' },
    crush: { kind: 'rotary', label: 'CRUSH', options: [16, 12, 8, 6, 4, 3, 2].map((v) => ({ v, l: v === 16 ? 'OFF' : `${v}bit` })), default: 16, size: 'sm' },
    drive: { kind: 'knob', label: 'DRIVE', min: 0, max: 0.95, default: 0, size: 'sm' },
  },
  inputs: { in: { type: 'pattern', label: 'IN' } },
  outputs: { out: { type: 'pattern', label: 'OUT' } },
  layout: [['room', 'size', 'drive'], ['delay', 'time', 'feedback'], ['crush'], ['in:in', 'out:out']],
  compile(ctx) {
    let e = ctx.in('in');
    if (!e) return { out: null };
    const p = ctx.p;
    if (p.room > 0.005) e = e.call('room', num(p.room, 2)).call('roomsize', num(p.size, 1));
    if (p.delay > 0.005) {
      const secs = p.time * (240 / ctx.global.bpm);
      e = e.call('delay', num(p.delay, 2)).call('delaytime', num(secs)).call('delayfeedback', num(p.feedback, 2));
    }
    e = e.callIf(p.crush < 16, 'crush', num(p.crush));
    e = setIf(e, 'shape', p.drive, 0, 2);
    return { out: e };
  },
};

const LFO_SHAPES = ['sine', 'tri', 'saw', 'isaw', 'square', 'rand', 'perlin'];
const LFO_RATES = [
  { v: 8, l: 'x8' }, { v: 4, l: 'x4' }, { v: 2, l: 'x2' }, { v: 1, l: '1 BAR' },
  { v: 0.5, l: '2 BAR' }, { v: 0.25, l: '4 BAR' }, { v: 0.125, l: '8 BAR' }, { v: 0.0625, l: '16 BAR' },
];

export const lfo = {
  type: 'lfo',
  name: 'LFO',
  title: 'Low Frequency Oscillator',
  category: 'Modulate',
  hp: 6,
  description: 'A slow wave for moving knobs automatically. Patch CV into a FILTER, a VOICE PAN or the VANDALIZER. RATE is how long one sweep takes. STEP turns it into stepped sample-and-hold.',
  params: {
    shape: { kind: 'rotary', label: 'SHAPE', options: LFO_SHAPES.map((v) => ({ v, l: v.toUpperCase() })), default: 'sine', structural: true },
    rate: { kind: 'rotary', label: 'RATE', options: LFO_RATES, default: 0.25, structural: true },
    step: { kind: 'toggle', label: 'STEP', default: false, structural: true },
  },
  inputs: {},
  outputs: { cv: { type: 'cv', label: 'CV' } },
  layout: [['widget:lfoScope'], ['shape'], ['rate'], ['step'], ['out:cv']],
  compile(ctx) {
    let e = rated(ident(ctx.p.shape), ctx.p.rate);
    if (ctx.p.step) e = e.call('segment', num(16));
    ctx.meta({ shape: ctx.p.shape, rate: ctx.p.rate, step: ctx.p.step });
    return { cv: e };
  },
};

const CH = [0, 1, 2, 3];
export const mixer = {
  type: 'mixer',
  name: 'MIXER',
  title: '4-Channel Mixer',
  category: 'Mix',
  hp: 16,
  description: 'Stacks up to four patterns so they play together, each with its own level, pan and mute.',
  params: Object.fromEntries(CH.flatMap((i) => [
    [`level${i}`, { kind: 'knob', label: `LVL ${i + 1}`, min: 0, max: 1.5, default: 1 }],
    [`pan${i}`, { kind: 'knob', label: 'PAN', min: 0, max: 1, default: 0.5, size: 'sm' }],
    [`mute${i}`, { kind: 'toggle', label: 'MUTE', default: false, structural: true }],
  ])),
  inputs: Object.fromEntries(CH.map((i) => [`in${i}`, { type: 'pattern', label: `IN ${i + 1}` }])),
  outputs: { out: { type: 'pattern', label: 'MIX' } },
  layout: [CH.map((i) => `level${i}`), CH.map((i) => `pan${i}`), CH.map((i) => `mute${i}`), [...CH.map((i) => `in:in${i}`), 'out:out']],
  compile(ctx) {
    const parts = [];
    for (const i of CH) {
      let e = ctx.in(`in${i}`);
      if (!e || ctx.p[`mute${i}`]) continue;
      e = setIf(e, 'postgain', ctx.p[`level${i}`], 1, 2);
      e = setIf(e, 'pan', ctx.p[`pan${i}`], 0.5, 2);
      parts.push(e);
    }
    if (!parts.length) return { out: null };
    return { out: parts.length === 1 ? parts[0] : fn('stack', ...parts) };
  },
};

export const output = {
  type: 'output',
  name: 'OUTPUT',
  title: 'Master Output & Scope',
  category: 'Mix',
  hp: 14,
  singleton: true,
  description: 'Where everything ends up. One cable = mono; L and R both patched = hard left/right. VOLUME and MUTE are your speakers, not part of the music, so they never show up in the code.',
  params: {
    volume: { kind: 'fader', label: 'MASTER', min: -60, max: 6, default: -6, unit: 'dB', hardware: true, marks: [6, 0, -6, -12, -24, -40, -60] },
    mute: { kind: 'toggle', label: 'MUTE', default: false, hardware: true },
  },
  inputs: { l: { type: 'pattern', label: 'L' }, r: { type: 'pattern', label: 'R/MONO' } },
  outputs: {},
  layout: [['widget:scope'], ['widget:meters', 'volume'], ['mute', 'in:l', 'in:r']],
  compile(ctx) {
    const l = ctx.in('l');
    const r = ctx.in('r');
    if (l && r) return { main: fn('stack', l.call('pan', num(0)), r.call('pan', num(1))) };
    return { main: l || r || null };
  },
};
