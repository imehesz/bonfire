// Pattern processors: VANDALIZER, FILTER, FX, VINTAGE, TAPE, LFO, DUCK, MIXER, OUTPUT.
import { arrow, fn, ident, lambda, mini, num, printExpr, raw } from '../core/expr.js';
import { RATES, isDefault, rated, setIf } from './helpers.js';

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

// VINTAGE: one knob's worth of a classic sampler's colour, built from superdough's per-event
// effects: bit depth (crush), sample-rate reduction (coarse, a whole-number divider of the
// 44.1/48k context), the output filter (a lowpass limit), saturation (shape) and compression.
// AMOUNT scales every setting from clean (0) to the full model (1).
const VINTAGE_MODELS = {
  mpc60: { l: 'MPC60', bits: 12, coarse: 1, lpf: 14000, drive: 0.3, comp: [-14, 3] },
  mpc2k: { l: 'MPC2000', bits: 16, coarse: 1, lpf: 17000, drive: 0.15, comp: [-20, 4] },
  sp1200: { l: 'SP-1200', bits: 12, coarse: 2, lpf: 11000, drive: 0.3, comp: null },
  sp303: { l: 'SP-303', bits: 14, coarse: 1, lpf: 8000, drive: 0.35, comp: [-26, 6] },
  s950: { l: 'S950', bits: 12, coarse: 1, lpf: 10000, drive: 0.15, comp: null },
  emu2: { l: 'EMU II', bits: 9, coarse: 2, lpf: 9000, drive: 0.2, comp: null },
};

// Like cutLimit: if the chain already sets `name`, keep whichever is rougher per event
// instead of overwriting it (pick 'min' for crush bits, 'max' for coarse / shape).
function roughLimit(e, name, value, pick, digits = 2) {
  if (!new RegExp(`\\b${name}\\(`).test(printExpr(e))) return e.call(name, num(value, digits));
  const v = Number(value.toFixed(digits));
  return e.call('withValue', raw(`v => ({ ...v, ${name}: Math.${pick}(v.${name} ?? ${v}, ${v}) })`));
}

export const vintage = {
  type: 'vintage',
  name: 'VINTAGE',
  title: 'Vintage Sampler Colour',
  category: 'Shape',
  hp: 10,
  description: 'Makes whatever runs through it sound like it came out of a classic sampler. MODEL picks the machine: MPC60 (12-bit, warm and saturated), MPC2000 (clean 16-bit punch), SP-1200 (12-bit at ~26 kHz, gritty aliasing), SP-303 (dark, squashed lo-fi), S950 (12-bit with its smooth low-pass) or EMU II (crunchy ~8-bit at ~27 kHz). AMOUNT goes from clean to the full machine. SWING is MPC-style 16th-note swing for everything it receives: 50% is straight, 66% is triplet feel, 75% is the hardest. Put it last, just before OUTPUT, to colour the whole track. It never makes anything cleaner: if an earlier FX already crushes, drives or filters harder, that wins.',
  params: {
    model: { kind: 'rotary', label: 'MODEL', options: Object.entries(VINTAGE_MODELS).map(([v, m]) => ({ v, l: m.l })), default: 'mpc60', structural: true },
    amount: { kind: 'knob', label: 'AMOUNT', min: 0, max: 1, default: 1, size: 'lg' },
    swing: { kind: 'knob', label: 'SWING', min: 50, max: 75, default: 50, step: 1, size: 'sm', unit: '%' },
  },
  inputs: { in: { type: 'pattern', label: 'IN' } },
  outputs: { out: { type: 'pattern', label: 'OUT' } },
  layout: [['model'], ['amount'], ['swing'], ['in:in', 'out:out']],
  compile(ctx) {
    let e = ctx.in('in');
    if (!e) return { out: null };
    const { amount: a, swing } = ctx.p;
    const m = VINTAGE_MODELS[ctx.p.model] ?? VINTAGE_MODELS.mpc60;
    if (swing > 50.5) e = e.call('swingBy', num((swing - 50) / 50, 2), num(8));
    if (a < 0.005) return { out: e };
    e = cutLimit(e, 'lpf', 20000 * (m.lpf / 20000) ** a, 20000);
    if (m.coarse > 1 && a >= 0.5) e = roughLimit(e, 'coarse', m.coarse, 'max', 0);
    const bits = 16 - a * (16 - m.bits);
    if (bits < 15.5) e = roughLimit(e, 'crush', bits, 'min', 1);
    if (m.drive * a > 0.01) e = roughLimit(e, 'shape', m.drive * a, 'max', 2);
    if (m.comp) e = e.call('compressor', mini(`${Math.round(m.comp[0] * a)}:${1 + (m.comp[1] - 1) * a}:6:0.005:0.12`));
    return { out: e };
  },
};

// TAPE: a multi-head tape echo built from pattern echoes, not the orbit delay.
// Each repeat is a re-triggered copy of the event that comes back quieter,
// darker and wobblier than the one before, the way a worn tape loop does.
const TAPE_TIMES = [
  { v: 1 / 16, l: '1/16' }, { v: 1 / 8, l: '1/8' }, { v: 3 / 16, l: '3/16' }, { v: 1 / 4, l: '1/4' },
  { v: 3 / 8, l: '3/8' }, { v: 1 / 2, l: '1/2' }, { v: 3 / 4, l: '3/4' }, { v: 1, l: '1 BAR' },
];
const TAPE_HEADS = ['1', '2', '3', '1+2', '2+3', '1+3', '1+2+3'];
const TAPE_MAX_ECHOES = 12; // per input event, shared by the active heads

export const tape = {
  type: 'tape',
  name: 'TAPE',
  title: 'Tape Echo',
  category: 'Shape',
  hp: 16,
  description: 'A three-head tape echo. TIME is the spacing of head 1; heads 2 and 3 sit at twice and three times that, and HEADS picks which ones play. Every repeat comes back quieter (REPEATS), darker (TONE, then AGE per pass), saturated (SAT) and warbling (WOW). ECHO is the wet level; the dry signal always passes. If the input already has a lowpass, the echoes keep it and AGE darkens it further. CV swells the ECHO level.',
  params: {
    time: { kind: 'rotary', label: 'TIME', options: TAPE_TIMES, default: 3 / 16, size: 'sm', structural: true },
    heads: { kind: 'rotary', label: 'HEADS', options: TAPE_HEADS.map((v) => ({ v, l: v })), default: '1', size: 'sm', structural: true },
    repeats: { kind: 'knob', label: 'REPEATS', min: 0, max: 0.95, default: 0.5, size: 'sm' },
    echo: { kind: 'knob', label: 'ECHO', min: 0, max: 1, default: 0.6, size: 'sm' },
    tone: { kind: 'knob', label: 'TONE', min: 300, max: 20000, default: 3200, curve: 'log', size: 'sm', unit: 'Hz' },
    age: { kind: 'knob', label: 'AGE', min: 0, max: 1, default: 0.4, size: 'sm' },
    sat: { kind: 'knob', label: 'SAT', min: 0, max: 0.9, default: 0.25, size: 'sm' },
    wow: { kind: 'knob', label: 'WOW', min: 0, max: 1, default: 0.3, size: 'sm' },
  },
  inputs: { in: { type: 'pattern', label: 'IN' }, cv: { type: 'cv', label: 'CV' } },
  outputs: { out: { type: 'pattern', label: 'OUT' } },
  layout: [['widget:tapeDeck'], ['time', 'heads'], ['repeats', 'echo', 'tone'], ['age', 'sat', 'wow'], ['in:in', 'in:cv', 'out:out']],
  compile(ctx) {
    const e = ctx.in('in');
    const p = ctx.p;
    const heads = String(p.heads).split('+').map(Number);
    ctx.meta({ time: p.time, heads });
    if (!e) return { out: null };
    if (p.echo < 0.005) return { out: e };
    const fb = p.repeats;
    const cap = Math.floor(TAPE_MAX_ECHOES / heads.length);
    const wanted = fb < 0.02 ? 1 : Math.ceil(Math.log(0.03) / Math.log(fb));
    const count = Math.max(1, Math.min(cap, wanted));
    // a tail cut short by the cap fades out instead of stopping dead
    const taper = wanted > count ? ` * (1 - n / ${count})` : '';
    const level = p.echo / Math.sqrt(heads.length);
    const hasLpf = /\.lpf\(/.test(printExpr(e));
    const darken = 1 - p.age * 0.5;
    const cv = ctx.in('cv');
    const n6 = (v) => num(v, 6).text;

    const head = (k) => lambda((x) => {
      const spacing = num(p.time * k, 6);
      let w = x.call('late', spacing);
      if (cv) w = w.call('velocity', cv.call('range', num(0), num(level, 3)));
      w = w.callIf(p.sat > 0.005, 'shape', num(p.sat, 2));
      w = w.callIf(p.wow > 0.005, 'vib', num(3.5));
      let r = ident('e');
      const gain = `${fb > 0 ? `${n6(fb)} ** n` : '(n ? 0 : 1)'}${taper}`;
      r = cv ? r.call('mul', fn('velocity', raw(gain))) : r.call('velocity', raw(`${n6(level)} * ${gain}`));
      if (hasLpf) r = r.callIf(darken < 0.999, 'mul', fn('lpf', raw(`${n6(darken)} ** n`)));
      else if (p.tone < 19999) r = r.call('lpf', raw(`${Math.round(p.tone)}${darken < 0.999 ? ` * ${n6(darken)} ** n` : ''}`));
      if (p.wow > 0.005) r = r.call('vibmod', raw(`${n6(p.wow * 0.35)} * (1 + n * 0.3)`));
      return w.call('echoWith', num(count), spacing, arrow('e, n', r));
    });
    return { out: e.call('superimpose', ...heads.map(head)) };
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

// DUCK: Strudel ducks a whole orbit, so IN moves onto an orbit of its own (orbit 1 is
// everything else) and a silent copy of TRIG (postgain 0) fires the ducking.
export const duck = {
  type: 'duck',
  name: 'DUCK',
  title: 'Sidechain Ducker',
  category: 'Mix',
  hp: 8,
  description: 'The house / techno pump: IN dips in volume every time TRIG hits, then swells back, so pads and bass breathe with the kick. Patch the kick into TRIG as well as into your mix (the trigger copy is silent). Everything on TRIG ducks, so give it a BEATS with just the kick. DEPTH is how far it dips, RELEASE how long it takes to come back (seconds).',
  params: {
    depth: { kind: 'knob', label: 'DEPTH', min: 0, max: 1, default: 0.8, size: 'lg' },
    release: { kind: 'knob', label: 'RELEASE', min: 0.02, max: 1, default: 0.2, curve: 'log', unit: 's' },
  },
  inputs: { in: { type: 'pattern', label: 'IN' }, trig: { type: 'pattern', label: 'TRIG' } },
  outputs: { out: { type: 'pattern', label: 'OUT' } },
  layout: [['depth'], ['release'], ['in:in', 'in:trig', 'out:out']],
  compile(ctx) {
    const e = ctx.in('in');
    if (!e) return { out: null };
    const trig = ctx.in('trig');
    if (!trig) return { out: e };
    const orbit = 1 + (parseInt(ctx.id.replace(/\D/g, ''), 10) || 1); // duck1 -> orbit 2
    const ducker = trig.call('duckorbit', num(orbit)).call('duckonset', num(0.005, 3))
      .call('duckattack', num(ctx.p.release, 3)).call('duckdepth', num(ctx.p.depth, 2)).call('postgain', num(0));
    return { out: fn('stack', e.call('orbit', num(orbit)), ducker) };
  },
};

const CH = [0, 1, 2, 3];
// MIXER LO/HI CUT. Nothing upstream filters: a plain .hpf()/.lpf(). Something does (FILTER, TAPE):
// limit it per event instead of overwriting it, so its sweeps / tone / echo darkening keep working.
// Strudel stores lpf as `cutoff`, hpf as `hcutoff`.
function cutLimit(e, name, value, off) {
  if (isDefault(value, off)) return e;
  const hz = Math.round(value);
  if (!new RegExp(`\\b${name}\\(`).test(printExpr(e))) return e.call(name, num(hz, 0));
  const [key, pick] = name === 'lpf' ? ['cutoff', 'min'] : ['hcutoff', 'max'];
  return e.call('withValue', raw(`v => ({ ...v, ${key}: Math.${pick}(v.${key} ?? ${hz}, ${hz}) })`));
}
export const mixer = {
  type: 'mixer',
  name: 'MIXER',
  title: '4-Channel Mixer',
  category: 'Mix',
  hp: 16,
  description: 'Stacks up to four patterns so they play together, each with its own level, pan and mute. LO CUT trims the rumble below its frequency (keep it down on kick and bass, turn it up on everything else so the low end stays clean); HI CUT tames harsh tops. Fully counter-clockwise LO CUT / fully clockwise HI CUT = off; the little LED lights while a cut is on. A cut is a limit, not an override: if a FILTER or TAPE earlier in the chain already filters, it keeps working, but HI CUT never lets it get brighter than its setting, and LO CUT never lets it reach lower. ALL mutes the whole mix and leaves the channel mutes as they were.',
  params: {
    ...Object.fromEntries(CH.flatMap((i) => [
      [`level${i}`, { kind: 'knob', label: `LVL ${i + 1}`, min: 0, max: 1.5, default: 1 }],
      [`pan${i}`, { kind: 'knob', label: 'PAN', min: 0, max: 1, default: 0.5, size: 'sm' }],
      [`locut${i}`, { kind: 'knob', label: 'LO CUT', min: 20, max: 2000, default: 20, curve: 'log', size: 'sm', unit: 'Hz', led: true }],
      [`hicut${i}`, { kind: 'knob', label: 'HI CUT', min: 500, max: 20000, default: 20000, curve: 'log', size: 'sm', unit: 'Hz', led: true }],
      [`mute${i}`, { kind: 'toggle', label: 'MUTE', default: false, structural: true }],
    ])),
    muteAll: { kind: 'toggle', label: 'ALL', default: false, structural: true },
  },
  inputs: Object.fromEntries(CH.map((i) => [`in${i}`, { type: 'pattern', label: `IN ${i + 1}` }])),
  outputs: { out: { type: 'pattern', label: 'MIX' } },
  // rows sit on a 5-column grid (CSS) so each channel lines up over its IN jack
  layout: [CH.map((i) => `level${i}`), CH.map((i) => `pan${i}`), CH.map((i) => `locut${i}`), CH.map((i) => `hicut${i}`), [...CH.map((i) => `mute${i}`), 'muteAll'], [...CH.map((i) => `in:in${i}`), 'out:out']],
  compile(ctx) {
    if (ctx.p.muteAll) return { out: ident('silence') };
    const parts = [];
    for (const i of CH) {
      let e = ctx.in(`in${i}`);
      if (!e || ctx.p[`mute${i}`]) continue;
      e = setIf(e, 'postgain', ctx.p[`level${i}`], 1, 2);
      e = setIf(e, 'pan', ctx.p[`pan${i}`], 0.5, 2);
      e = cutLimit(e, 'hpf', ctx.p[`locut${i}`], 20);
      e = cutLimit(e, 'lpf', ctx.p[`hicut${i}`], 20000);
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
  description: 'Where everything ends up. One cable = mono; L and R both patched = hard left/right. VOLUME and MUTE are your speakers, not part of the music, so they never show up in the code. STYLE picks the scope look, COLOR tints it (right-click for the skin colour), FULL blows the scope up to the whole screen; BACK puts it behind the rack instead, see-through, so you can keep tweaking while it plays.',
  params: {
    style: { kind: 'rotary', label: 'STYLE', size: 'sm', hardware: true, default: 'trace', options: [
      { v: 'trace', l: 'TRACE' }, { v: 'orbit', l: 'ORBIT' }, { v: 'bars', l: 'BARS' }, { v: 'halo', l: 'HALO' }, { v: 'fall', l: 'FALL' },
    ] },
    color: { kind: 'color', label: 'COLOR', default: '', hardware: true },
    volume: { kind: 'fader', label: 'MASTER', min: -60, max: 6, default: -6, unit: 'dB', hardware: true, marks: [6, 0, -6, -12, -24, -40, -60] },
    mute: { kind: 'toggle', label: 'MUTE', default: false, hardware: true },
  },
  inputs: { l: { type: 'pattern', label: 'L' }, r: { type: 'pattern', label: 'R/MONO' } },
  outputs: {},
  actions: { back: { label: 'BACK', click: true, led: true }, full: { label: 'FULL', click: true, led: true } },
  layout: [['widget:scope'], ['style', 'color', 'back', 'full'], ['widget:meters', 'volume'], ['mute', 'in:l', 'in:r']],
  compile(ctx) {
    const l = ctx.in('l');
    const r = ctx.in('r');
    if (l && r) return { main: fn('stack', l.call('pan', num(0)), r.call('pan', num(1))) };
    return { main: l || r || null };
  },
};
