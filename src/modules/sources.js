// Timing + event sources: CLOCK, SEQ-16, BEATS, MELODY, EUCLID.
import { fn, mini } from '../core/expr.js';
import { BANKS, DRUM_SOUNDS, ROOTS, SCALES, bankLabel } from '../core/music.js';
import { miniExpr, stepToken, timed } from './helpers.js';

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
    const e = fn('n', mini(tokens.join(' '))).call('scale', mini(`${root}${octave}:${scale}`));
    return { pitch: timed(e, dur) };
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

