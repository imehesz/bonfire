// Timing + event sources: CLOCK, SEQ-16, BEATS, MELODY, ARP, EUCLID, CHAIN.
import { fn, mini, obj } from '../core/expr.js';
import { BANKS, DRUM_SOUNDS, ROOTS, SCALES, bankLabel, scaleArg, scaleLength } from '../core/music.js';
import { miniExpr, num, setIf, stepToken, timed } from './helpers.js';

const CLOCK_OUTS = [
  ['x4', 'x4', 1 / 16], ['x2', 'x2', 1 / 8], ['d1', '/1', 1 / 4],
  ['d2', '/2', 1 / 2], ['d4', '/4', 1], ['d8', '/8', 2],
];

export const clock = {
  type: 'clock',
  name: 'CLOCK',
  title: 'Master Clock',
  category: 'Time',
  hp: 8,
  singleton: true,
  description: 'Sets the global tempo. Clock jacks set how long each step lasts on any sequencer they patch into: x4 = 16th notes, /1 = quarter notes, /8 = two bars.',
  params: {
    bpm: { kind: 'knob', label: 'TEMPO', min: 40, max: 240, default: 120, step: 1, size: 'lg', unit: 'BPM', structural: true },
  },
  actions: { tap: { kind: 'button', label: 'TAP' } },
  inputs: {},
  outputs: Object.fromEntries(CLOCK_OUTS.map(([id, label]) => [id, { type: 'clock', label }])),
  layout: [['widget:bpmDisplay'], ['bpm'], ['tap', 'led:beat'], ['out:x4', 'out:x2', 'out:d1'], ['out:d2', 'out:d4', 'out:d8']],
  compile() {
    return Object.fromEntries(CLOCK_OUTS.map(([id, , v]) => [id, v]));
  },
};

const STEP_MODES = [{ v: 1, l: 'TRIG' }, { v: 0, l: 'REST' }, { v: 2, l: 'x2' }, { v: 3, l: 'x4' }];

export const seq = {
  type: 'seq',
  name: 'SEQ-16',
  title: 'Pattern Sequencer',
  category: 'Rhythm',
  hp: 18,
  description: 'Sixteen-step trigger sequencer written as mini-notation. Pick an edit mode (TRIG / REST / x2 / x4) and click steps; right-click a step to cycle it. PAT plays its own sound, RHY sends just the rhythm to a VOICE or SAMPLER.',
  params: {
    steps: { kind: 'data', default: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], structural: true },
    mode: { kind: 'switch', label: 'EDIT', options: STEP_MODES, default: 1 },
    length: { kind: 'knob', label: 'LENGTH', min: 1, max: 16, default: 16, step: 1, structural: true },
    sound: { kind: 'sound', label: 'SOUND', default: 'bd', structural: true },
  },
  inputs: { clk: { type: 'clock', label: 'CLK' } },
  outputs: { pat: { type: 'pattern', label: 'PAT' }, rhy: { type: 'rhythm', label: 'RHY' } },
  layout: [['widget:steps'], ['mode', 'length'], ['sound'], ['in:clk', 'out:rhy', 'out:pat']],
  compile(ctx) {
    const { steps, length, sound } = ctx.p;
    const used = steps.slice(0, length);
    const dur = (ctx.in('clk') ?? 1 / 16) * length;
    ctx.meta({ steps: length, dur });
    const pat = used.map((s) => stepToken(s, sound)).join(' ');
    const rhy = used.map((s) => stepToken(s, 'x')).join(' ');
    return {
      pat: timed(fn('s', mini(pat)), dur),
      rhy: timed(miniExpr(rhy), dur),
    };
  },
};

const LANES = 4;
export const beats = {
  type: 'beats',
  name: 'BEATS',
  title: 'Drum Grid',
  category: 'Rhythm',
  hp: 30,
  description: 'Four-lane, sixteen-step drum machine. Each lane picks a drum sound, the BANK picks the machine (808, 909, LinnDrum...). Right-click a step for x2 / x4 rolls.',
  params: {
    grid: {
      kind: 'data',
      structural: true,
      default: [
        [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
        [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
        [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      ],
    },
    lane0: { kind: 'select', label: 'L1', options: DRUM_SOUNDS, default: 'bd', structural: true },
    lane1: { kind: 'select', label: 'L2', options: DRUM_SOUNDS, default: 'sd', structural: true },
    lane2: { kind: 'select', label: 'L3', options: DRUM_SOUNDS, default: 'hh', structural: true },
    lane3: { kind: 'select', label: 'L4', options: DRUM_SOUNDS, default: 'oh', structural: true },
    bank: { kind: 'select', label: 'BANK', options: BANKS.map((b) => ({ v: b, l: bankLabel(b) })), default: 'RolandTR909', structural: true },
    length: { kind: 'knob', label: 'LENGTH', min: 1, max: 16, default: 16, step: 1, structural: true },
  },
  inputs: { clk: { type: 'clock', label: 'CLK' } },
  outputs: { out: { type: 'pattern', label: 'OUT' } },
  layout: [['widget:grid'], ['bank', 'length', 'in:clk', 'out:out']],
  compile(ctx) {
    const { grid, length, bank } = ctx.p;
    const dur = (ctx.in('clk') ?? 1 / 16) * length;
    ctx.meta({ steps: length, dur });
    const lanes = [];
    for (let i = 0; i < LANES; i++) {
      const row = grid[i].slice(0, length);
      if (!row.some(Boolean)) continue;
      lanes.push(fn('s', mini(row.map((s) => stepToken(s, ctx.p[`lane${i}`])).join(' '))));
    }
    if (!lanes.length) return { out: null };
    let out = lanes.length === 1 ? lanes[0] : fn('stack', ...lanes);
    if (bank) out = out.call('bank', mini(bank));
    return { out: timed(out, dur) };
  },
};

const STEPS8 = 8;
export const melody = {
  type: 'melody',
  name: 'MELODY',
  title: 'Note Sequencer',
  category: 'Pitch',
  hp: 18,
  description: 'Eight-step note sequencer locked to a scale, so every knob position is in key. Patch PITCH into a VOICE (or straight into OUTPUT for a quick triangle synth).',
  params: {
    degrees: { kind: 'data', default: [0, 2, 4, 2, 7, 4, 2, 4], structural: true },
    gates: { kind: 'data', default: [1, 1, 1, 0, 1, 1, 0, 1], structural: true },
    root: { kind: 'select', label: 'ROOT', options: ROOTS, default: 'C', structural: true },
    scale: { kind: 'select', label: 'SCALE', options: SCALES.map(([v, l]) => ({ v, l })), default: 'minor', structural: true },
    octave: { kind: 'knob', label: 'OCT', min: 1, max: 6, default: 3, step: 1, structural: true },
    length: { kind: 'knob', label: 'LENGTH', min: 1, max: 8, default: 8, step: 1, structural: true },
  },
  inputs: { clk: { type: 'clock', label: 'CLK' } },
  outputs: { pitch: { type: 'pitch', label: 'PITCH' } },
  layout: [['widget:melody'], ['root', 'scale'], ['octave', 'length', 'in:clk', 'out:pitch']],
  compile(ctx) {
    const { degrees, gates, root, scale, octave, length } = ctx.p;
    const dur = (ctx.in('clk') ?? 1 / 8) * length;
    ctx.meta({ steps: length, dur });
    const tokens = [];
    for (let i = 0; i < length; i++) tokens.push(gates[i] ? String(degrees[i]) : '~');
    if (!tokens.some((t) => t !== '~')) return { pitch: null };
    const e = fn('n', mini(tokens.join(' '))).call('scale', mini(scaleArg(root, octave, scale)));
    return { pitch: timed(e, dur) };
  },
};

// Chord shapes as scale-degree offsets, so every chord is stacked in key.
const ARP_SHAPES = {
  triad: { l: 'TRIAD', d: [0, 2, 4] },
  sev: { l: '7TH', d: [0, 2, 4, 6] },
  nine: { l: '9TH', d: [0, 2, 4, 6, 8] },
  sus2: { l: 'SUS2', d: [0, 1, 4] },
  sus4: { l: 'SUS4', d: [0, 3, 4] },
  fifth: { l: '5TH', d: [0, 4] },
  oct: { l: 'OCT', d: [0] },
};
const ARP_MODES = [
  { v: 'up', l: 'UP' }, { v: 'down', l: 'DOWN' }, { v: 'updn', l: 'UP-DN' },
  { v: 'dnup', l: 'DN-UP' }, { v: 'conv', l: 'CONV' }, { v: 'rand', l: 'RAND' },
];
const ARP_RATES = [{ v: 0.5, l: '1/2' }, { v: 1, l: '1 BAR' }, { v: 2, l: '2 BAR' }, { v: 4, l: '4 BAR' }];
export const ARP_SLOTS = 4;

// The note order one chord plays, as degree offsets from its root.
export function arpOrder(shape, range, mode, scale) {
  const span = scaleLength(scale);
  const up = [];
  for (let o = 0; o < range; o++) for (const d of ARP_SHAPES[shape].d) up.push(d + o * span);
  const down = [...up].reverse();
  if (up.length < 3) return mode === 'down' || mode === 'dnup' ? down : up;
  if (mode === 'down') return down;
  if (mode === 'updn') return [...up, ...down.slice(1, -1)];
  if (mode === 'dnup') return [...down, ...up.slice(1, -1)];
  if (mode === 'conv') return up.map((_, i) => (i % 2 ? up[up.length - 1 - (i >> 1)] : up[i >> 1]));
  return up; // up, and the pool rand picks from
}

export const arp = {
  type: 'arp',
  name: 'ARP',
  title: 'Arpeggiator',
  category: 'Pitch',
  hp: 18,
  description: 'Plays chords one note at a time. The four slots are a chord progression: each knob picks the scale degree a chord is built on, and the chord is stacked in key (the numeral shows what you get). SHAPE is the chord, MODE the note order, RANGE how many octaves it climbs, CHORD how long each chord lasts. CLK sets the note speed (16ths by default). GATE shortens the notes, SWING shuffles them, RETRIG starts the pattern from the bottom on every chord change. Patch PITCH into a VOICE.',
  params: {
    degrees: { kind: 'data', default: [0, 5, 3, 4], structural: true },
    chords: { kind: 'knob', label: 'CHORDS', min: 1, max: ARP_SLOTS, default: 4, step: 1, size: 'sm', structural: true },
    root: { kind: 'select', label: 'ROOT', options: ROOTS, default: 'C', structural: true },
    scale: { kind: 'select', label: 'SCALE', options: SCALES.map(([v, l]) => ({ v, l })), default: 'minor', structural: true },
    shape: { kind: 'rotary', label: 'SHAPE', options: Object.entries(ARP_SHAPES).map(([v, o]) => ({ v, l: o.l })), default: 'triad', size: 'sm', structural: true },
    mode: { kind: 'rotary', label: 'MODE', options: ARP_MODES, default: 'up', size: 'sm', structural: true },
    rate: { kind: 'rotary', label: 'CHORD', options: ARP_RATES, default: 1, size: 'sm', structural: true },
    octave: { kind: 'knob', label: 'OCT', min: 1, max: 6, default: 4, step: 1, size: 'sm', structural: true },
    range: { kind: 'knob', label: 'RANGE', min: 1, max: 4, default: 2, step: 1, size: 'sm', structural: true },
    gate: { kind: 'knob', label: 'GATE', min: 0.05, max: 1, default: 0.6, size: 'sm' },
    swing: { kind: 'knob', label: 'SWING', min: 0, max: 0.6, default: 0, size: 'sm' },
    retrig: { kind: 'toggle', label: 'RETRIG', default: true, structural: true },
  },
  inputs: { clk: { type: 'clock', label: 'CLK' } },
  outputs: { pitch: { type: 'pitch', label: 'PITCH' } },
  layout: [['widget:arp'], ['root', 'scale'], ['shape', 'mode', 'rate'], ['octave', 'range', 'chords', 'gate', 'swing'], ['retrig', 'in:clk', 'out:pitch']],
  compile(ctx) {
    const p = ctx.p;
    const step = ctx.in('clk') ?? 1 / 16;
    const order = arpOrder(p.shape, p.range, p.mode, p.scale);
    const roots = p.degrees.slice(0, p.chords);
    const per = 1 / step; // steps per cycle
    const whole = Math.abs(per - Math.round(per)) < 1e-9;
    const k = whole ? Math.round(per) : 1;
    // RETRIG only changes anything when the order doesn't divide a chord evenly
    const chordSteps = p.rate / step;
    const retrig = p.retrig && p.mode !== 'rand' && roots.length > 1 && chordSteps >= 1
      && Math.abs(chordSteps / order.length - Math.round(chordSteps / order.length)) > 1e-9;
    ctx.meta({ step, order, roots, chordDur: p.rate, retrig, rand: p.mode === 'rand' });

    let notes = p.mode === 'rand'
      ? miniExpr(`[${order.join('|')}]${k > 1 ? `*${k}` : ''}`)
      : miniExpr(`{${order.join(' ')}}%${k}`);
    if (!whole) notes = timed(notes, step);
    if (retrig) notes = notes.call('restart', timed(miniExpr('x'), p.rate));
    if (roots.some((d) => d !== 0)) {
      const prog = roots.length === 1 ? num(roots[0]) : timed(miniExpr(`<${roots.join(' ')}>`), p.rate);
      notes = notes.call('add', prog);
    }
    let e = fn('n', notes).call('scale', mini(scaleArg(p.root, p.octave, p.scale)));
    e = setIf(e, 'clip', p.gate, 1, 2);
    // swing shuffles every second step, so it needs pairs of steps in a cycle
    if (p.swing > 0.005 && whole && k >= 2 && k % 2 === 0) e = e.call('swingBy', num(p.swing, 2), num(k / 2));
    return { pitch: e };
  },
};

export const euclid = {
  type: 'euclid',
  name: 'EUCLID',
  title: 'Euclidean Rhythm',
  category: 'Rhythm',
  hp: 8,
  description: 'Spreads PULSES as evenly as possible over STEPS (Bjorklund) — the trick behind most world-music rhythms. 3 in 8 is a tresillo, 5 in 8 a cinquillo.',
  params: {
    pulses: { kind: 'knob', label: 'PULSES', min: 1, max: 16, default: 3, step: 1, structural: true },
    steps: { kind: 'knob', label: 'STEPS', min: 1, max: 16, default: 8, step: 1, structural: true },
    rotate: { kind: 'knob', label: 'ROTATE', min: 0, max: 15, default: 0, step: 1, size: 'sm', structural: true },
    sound: { kind: 'sound', label: 'SOUND', default: 'cp', structural: true },
  },
  inputs: { clk: { type: 'clock', label: 'CLK' } },
  outputs: { pat: { type: 'pattern', label: 'PAT' }, rhy: { type: 'rhythm', label: 'RHY' } },
  layout: [['widget:euclidRing'], ['pulses', 'steps'], ['rotate'], ['sound'], ['in:clk', 'out:rhy', 'out:pat']],
  compile(ctx) {
    const steps = ctx.p.steps;
    const pulses = Math.min(ctx.p.pulses, steps);
    const rot = ctx.p.rotate % steps;
    const dur = (ctx.in('clk') ?? 1 / 16) * steps;
    ctx.meta({ steps, dur });
    const args = rot ? `(${pulses},${steps},${rot})` : `(${pulses},${steps})`;
    return {
      pat: timed(fn('s', mini(`${ctx.p.sound}${args}`)), dur),
      rhy: timed(miniExpr(`x${args}`), dur),
    };
  },
};


export const CHAIN_INPUTS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
export const CHAIN_SLOTS = 32;

export const chain = {
  type: 'chain',
  name: 'CHAIN',
  title: 'Song Chain',
  category: 'Time',
  hp: 18,
  description: 'Song mode. Patch up to eight parts into A-H (a MELODY, a VOICE, a whole drum group...) and write the order they play in, one slot per step: click a slot to step through A-H and rest, right-click to go back. CLK sets how long a slot lasts (1 bar by default). RESTART plays a part from its start every time its slot comes round; off, parts keep running in song time and the chain just picks which one you hear. OUT carries notes, so it can go into a VOICE\'s PITCH or anywhere a pattern goes.',
  params: {
    order: { kind: 'data', default: [0, 0, 1, 1, ...Array(CHAIN_SLOTS - 4).fill(-1)], structural: true },
    length: { kind: 'knob', label: 'LENGTH', min: 1, max: CHAIN_SLOTS, default: 4, step: 1, structural: true },
    restart: { kind: 'toggle', label: 'RESTART', default: true, structural: true },
  },
  inputs: {
    ...Object.fromEntries(CHAIN_INPUTS.map((k) => [k, { type: 'pattern', label: k.toUpperCase() }])),
    clk: { type: 'clock', label: 'CLK' },
  },
  outputs: { out: { type: 'pitch', label: 'OUT' } },
  layout: [['widget:chain'], ['length', 'restart', 'in:clk', 'out:out'],
    CHAIN_INPUTS.slice(0, 4).map((k) => `in:${k}`), CHAIN_INPUTS.slice(4).map((k) => `in:${k}`)],
  compile(ctx) {
    const { order, length, restart } = ctx.p;
    const step = ctx.in('clk') ?? 1;
    const dur = step * length;
    ctx.meta({ steps: length, dur });
    const parts = Object.fromEntries(CHAIN_INPUTS.map((k) => [k, ctx.in(k)]).filter(([, e]) => e));
    // a slot pointing at an unpatched input is a rest
    const tokens = order.slice(0, length).map((v) => (CHAIN_INPUTS[v] in parts ? CHAIN_INPUTS[v] : '~'));
    const used = CHAIN_INPUTS.filter((k) => tokens.includes(k));
    if (!used.length) return { out: null };
    const sel = Math.abs(step - 1) < 1e-9 ? miniExpr(`<${tokens.join(' ')}>`) : timed(miniExpr(tokens.join(' ')), dur);
    return { out: sel.call(restart ? 'pickRestart' : 'pick', obj(used.map((k) => [k, parts[k]]))) };
  },
};
