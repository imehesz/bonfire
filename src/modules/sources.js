// Timing + event sources: CLOCK, SEQ-16, BEATS, MELODY, ARP, CHORDS, EUCLID, CHAIN.
import { fn, mini, obj } from '../core/expr.js';
import { BANKS, DRUM_SOUNDS, ROOTS, SCALES, bankLabel, midiToNote, pcName, scaleArg, scaleLength, scaleSteps, useSharps } from '../core/music.js';
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
  description: 'Four-lane, sixteen-step drum machine. Each lane picks a drum sound and has its own small LEVEL knob; the BANK picks the machine (808, 909, LinnDrum...). SWING pushes every second step late for a shuffle. Patch an LFO into CV to move the volume of every hit (RAND humanizes, PERLIN drifts, a slow SINE swells). Right-click a step for x2 / x4 rolls.',
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
    level0: { kind: 'knob', label: 'L1 LEVEL', min: 0, max: 1.5, default: 1, size: 'xs' },
    level1: { kind: 'knob', label: 'L2 LEVEL', min: 0, max: 1.5, default: 1, size: 'xs' },
    level2: { kind: 'knob', label: 'L3 LEVEL', min: 0, max: 1.5, default: 1, size: 'xs' },
    level3: { kind: 'knob', label: 'L4 LEVEL', min: 0, max: 1.5, default: 1, size: 'xs' },
    length: { kind: 'knob', label: 'LENGTH', min: 1, max: 16, default: 16, step: 1, structural: true },
    swing: { kind: 'knob', label: 'SWING', min: 0, max: 0.6, default: 0 },
  },
  inputs: { clk: { type: 'clock', label: 'CLK' }, cv: { type: 'cv', label: 'CV' } },
  outputs: { out: { type: 'pattern', label: 'OUT' } },
  layout: [['widget:grid'], ['bank', 'length', 'swing', 'in:clk', 'in:cv', 'out:out']],
  compile(ctx) {
    const { grid, length, bank, swing } = ctx.p;
    const step = ctx.in('clk') ?? 1 / 16;
    const dur = step * length;
    ctx.meta({ steps: length, dur });
    const lanes = [];
    for (let i = 0; i < LANES; i++) {
      const row = grid[i].slice(0, length);
      if (!row.some(Boolean)) continue;
      lanes.push(setIf(fn('s', mini(row.map((s) => stepToken(s, ctx.p[`lane${i}`])).join(' '))), 'gain', ctx.p[`level${i}`], 1));
    }
    if (!lanes.length) return { out: null };
    let out = lanes.length === 1 ? lanes[0] : fn('stack', ...lanes);
    if (bank) out = out.call('bank', mini(bank));
    out = timed(out, dur);
    // swing shuffles every second step, so it needs pairs of steps in a cycle
    const per = 1 / step;
    const k = Math.round(per);
    if (swing > 0.005 && Math.abs(per - k) < 1e-9 && k >= 2 && k % 2 === 0) out = out.call('swingBy', num(swing, 2), num(k / 2));
    // CV scales each hit's volume; the floor keeps the quietest hits audible
    const cv = ctx.in('cv');
    if (cv) out = out.call('velocity', cv.call('range', num(0.25, 2), num(1)));
    return { out };
  },
};

const STEPS8 = 8;
export const melody = {
  type: 'melody',
  name: 'MELODY',
  title: 'Note Sequencer',
  category: 'Pitch',
  hp: 18,
  description: 'Up to sixteen-step note sequencer locked to a scale, so every knob position is in key. LENGTH sets how many steps play (the second row lights up past 8). Patch PITCH into a VOICE (or straight into OUTPUT for a quick triangle synth).',
  params: {
    // 16 steps; steps 9-16 repeat 1-8. Patches from the 8-step days hold 8-entry arrays,
    // so anything past their end reads as degree 0 / gate off.
    degrees: { kind: 'data', default: [0, 2, 4, 2, 7, 4, 2, 4, 0, 2, 4, 2, 7, 4, 2, 4], structural: true },
    gates: { kind: 'data', default: [1, 1, 1, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1, 0, 1], structural: true },
    root: { kind: 'select', label: 'ROOT', options: ROOTS, default: 'C', structural: true },
    scale: { kind: 'select', label: 'SCALE', options: SCALES.map(([v, l]) => ({ v, l })), default: 'minor', structural: true },
    octave: { kind: 'knob', label: 'OCT', min: 1, max: 6, default: 3, step: 1, structural: true },
    // default stays 8: saved patches omit default params, so a new default would change old songs
    length: { kind: 'knob', label: 'LENGTH', min: 1, max: 16, default: 8, step: 1, structural: true },
  },
  inputs: { clk: { type: 'clock', label: 'CLK' } },
  outputs: { pitch: { type: 'pitch', label: 'PITCH' } },
  layout: [['widget:melody'], ['root', 'scale'], ['octave', 'length', 'in:clk', 'out:pitch']],
  compile(ctx) {
    const { degrees, gates, root, scale, octave, length } = ctx.p;
    const dur = (ctx.in('clk') ?? 1 / 8) * length;
    ctx.meta({ steps: length, dur });
    const tokens = [];
    for (let i = 0; i < length; i++) tokens.push(gates[i] ? String(degrees[i] ?? 0) : '~');
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

// CHORDS: a progression of up to eight chords, played as stacked notes. Chords
// are built in JS (not with tonal's voicing()) so the exported code is plain
// note names and voice-leading is ours to tune.
export const CHORD_SLOTS = 8;
// Fixed chord qualities as semitones above the root; AUTO stacks the chord in key.
export const CHORD_QUALITIES = [
  { v: 'auto', l: 'AUTO' },
  { v: 'maj', l: 'MAJOR', s: [0, 4, 7] }, { v: 'min', l: 'MINOR', s: [0, 3, 7] },
  { v: '7', l: 'DOM 7', s: [0, 4, 7, 10] }, { v: 'maj7', l: 'MAJ 7', s: [0, 4, 7, 11] },
  { v: 'm7', l: 'MIN 7', s: [0, 3, 7, 10] }, { v: 'sus2', l: 'SUS 2', s: [0, 2, 7] },
  { v: 'sus4', l: 'SUS 4', s: [0, 5, 7] }, { v: 'dim', l: 'DIM', s: [0, 3, 6] },
  { v: 'aug', l: 'AUG', s: [0, 4, 8] }, { v: '5', l: 'POWER', s: [0, 7] },
];
const CHORD_SIZES = { triad: [0, 2, 4], sev: [0, 2, 4, 6], nine: [0, 2, 4, 6, 8] };
const CHORD_SUFFIX = {
  '0,4,7': '', '0,3,7': 'm', '0,3,6': '°', '0,4,8': '+', '0,2,7': 'sus2', '0,5,7': 'sus4', '0,7': '5',
  '0,4,7,10': '7', '0,4,7,11': 'maj7', '0,3,7,10': 'm7', '0,3,7,11': 'mM7', '0,3,6,10': 'ø7',
  '0,3,6,9': '°7', '0,4,8,11': '+M7', '0,4,8,10': '+7',
};
const NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
const QUALITY_NUMERAL = { '°': '°', '+': '+', ø7: 'ø7', '°7': '°7', '+7': '+7', '+M7': '+Δ7', mM7: 'Δ7', maj7: 'Δ7' };

// Chord symbol suffix for semitones above the root ('m7', 'sus4', 'maj9'...).
function chordSuffix(iv) {
  if (iv.length === 5) {
    const base = CHORD_SUFFIX[iv.slice(0, 4).join(',')];
    if (base == null) return '?';
    return iv[4] - 12 === 2 ? base.replace('7', '9') : `${base}b9`;
  }
  return CHORD_SUFFIX[iv.join(',')] ?? '?';
}

// Roman numeral from what the chord really is, so a borrowed MAJOR iv reads IV.
function chordRoman(scale, deg, iv) {
  const n = scaleLength(scale) === 7 ? NUMERALS[deg % 7] : String((deg % scaleLength(scale)) + 1);
  const suffix = chordSuffix(iv);
  const minor = iv.includes(3) && !iv.includes(4);
  const sym = QUALITY_NUMERAL[suffix] ?? (suffix.startsWith('°') ? '°' : suffix.startsWith('+') ? '+' : '');
  const ext = sym.length > 1 ? '' : iv.length === 5 ? '9' : iv.length === 4 ? '7' : '';
  return (minor ? n.toLowerCase() : n) + sym + ext;
}

const mean = (v) => v.reduce((a, b) => a + b, 0) / v.length;
const nearest = (a, b) => a.reduce((t, x) => t + Math.min(...b.map((y) => Math.abs(x - y))), 0);

// Root-position stack turned over `inv` times (lowest note up an octave each time).
function stackChord(base, iv, inv) {
  const notes = iv.map((i) => base + i);
  for (let k = 0; k < inv % notes.length; k++) notes.push(notes.shift() + 12);
  return notes;
}

// Every chord of the progression: name, numeral, MIDI notes and bass note.
// LEAD picks each chord's inversion and octave so the notes move as little as
// possible from the chord before, while staying near where the first chord sits.
export function chordPlan(p) {
  const steps = scaleSteps(p.scale);
  const n = steps.length;
  const semi = (d) => steps[d % n] + 12 * Math.floor(d / n);
  const key = ROOTS.indexOf(p.root);
  const sharps = useSharps(p.root, p.scale);
  const plan = [];
  let center = 0;
  for (let i = 0; i < p.length; i++) {
    const deg = p.degrees[i];
    const fixed = CHORD_QUALITIES.find((q) => q.v === p.quals[i])?.s;
    const root = semi(deg);
    const iv = fixed ?? CHORD_SIZES[p.size].map((o) => semi(deg + o) - root);
    const base = 12 * (p.octave + 1) + key + root;
    let notes;
    if (i === 0 || !p.lead) {
      notes = stackChord(base, iv, Math.min(p.inv, iv.length - 1));
      if (i === 0) center = mean(notes);
    } else {
      let cost = Infinity;
      for (let k = 0; k < iv.length; k++) {
        for (let sh = -24; sh <= 24; sh += 12) {
          const v = stackChord(base + sh, iv, k);
          const c = nearest(plan[i - 1].close, v) + nearest(v, plan[i - 1].close) + 0.5 * Math.abs(mean(v) - center);
          if (c < cost - 1e-9) [cost, notes] = [c, v];
        }
      }
    }
    // OPEN drops the second-highest note an octave (drop-2), SPREAD drops the lowest
    let played = [...notes].sort((a, b) => a - b);
    if (played.length >= 3 && p.voicing !== 'close') {
      played[p.voicing === 'open' ? played.length - 2 : 0] -= 12;
      played.sort((a, b) => a - b);
    }
    plan.push({
      name: pcName(key + root, sharps) + chordSuffix(iv),
      numeral: chordRoman(p.scale, deg, iv),
      close: notes,
      notes: played,
      bass: 12 * (p.bass + 1) + ((key + root) % 12),
    });
  }
  return plan;
}

// Famous progressions. Each sets SCALE, the chords, their qualities and LENGTH; ROOT stays.
export const CHORD_PRESETS = [
  { l: 'POP  I–V–vi–IV', scale: 'major', d: [0, 4, 5, 3] },
  { l: 'SAD POP  vi–IV–I–V', scale: 'major', d: [5, 3, 0, 4] },
  { l: 'DOO-WOP  I–vi–IV–V', scale: 'major', d: [0, 5, 3, 4] },
  { l: 'ROYAL ROAD  IV–V–iii–vi', scale: 'major', d: [3, 4, 2, 5] },
  { l: 'CANON  I–V–vi–iii–IV–I–IV–V', scale: 'major', d: [0, 4, 5, 2, 3, 0, 3, 4] },
  { l: 'ROCK  I–♭VII–IV–I', scale: 'mixolydian', d: [0, 6, 3, 0] },
  { l: 'EPIC  i–VI–III–VII', scale: 'minor', d: [0, 5, 2, 6] },
  { l: 'ANDALUSIAN  i–VII–VI–V', scale: 'minor', d: [0, 6, 5, 4], q: ['auto', 'auto', 'auto', 'maj'] },
  { l: 'GOTH  i–iv–VI–V', scale: 'minor', d: [0, 3, 5, 4], q: ['auto', 'auto', 'auto', 'maj'] },
  { l: 'JAZZ  ii7–V7–Imaj7', scale: 'major', d: [1, 4, 0, 0], q: ['m7', '7', 'maj7', 'maj7'] },
  { l: '8-BAR BLUES  I7–V7–IV7…', scale: 'major', d: [0, 4, 3, 3, 0, 4, 0, 4], q: Array(8).fill('7') },
];

// BASIC face: progressions grouped by how they feel. Picking a mood loads one,
// DICE rolls another from the same mood. `size` sets triads / 7ths for the mood.
export const CHORD_MOODS = [
  { v: 'happy', l: 'HAPPY', p: [
    { scale: 'major', d: [0, 4, 5, 3] }, { scale: 'major', d: [0, 3, 4, 3] }, { scale: 'major', d: [0, 5, 3, 4] },
    { scale: 'major', d: [0, 3, 5, 4] }, { scale: 'major', d: [0, 2, 3, 4] }] },
  { v: 'sad', l: 'SAD', p: [
    { scale: 'major', d: [5, 3, 0, 4] }, { scale: 'minor', d: [0, 3, 6, 2] }, { scale: 'minor', d: [0, 5, 3, 4] },
    { scale: 'major', d: [5, 2, 3, 0] }, { scale: 'minor', d: [0, 3, 0, 4] }] },
  { v: 'epic', l: 'EPIC', p: [
    { scale: 'minor', d: [0, 5, 2, 6] }, { scale: 'minor', d: [5, 6, 0, 0] }, { scale: 'minor', d: [0, 6, 5, 6] },
    { scale: 'minor', d: [0, 2, 6, 5] }, { scale: 'minor', d: [5, 2, 6, 0] }] },
  { v: 'dark', l: 'DARK', p: [
    { scale: 'minor', d: [0, 3, 5, 4], q: ['auto', 'auto', 'auto', 'maj'] },
    { scale: 'minor', d: [0, 6, 5, 4], q: ['auto', 'auto', 'auto', 'maj'] },
    { scale: 'phrygian', d: [0, 1, 0, 1] }, { scale: 'phrygian', d: [0, 1, 6, 0] },
    { scale: 'minor', d: [0, 5, 0, 4], q: ['auto', 'auto', 'auto', 'maj'] }] },
  { v: 'dreamy', l: 'DREAMY', size: 'sev', p: [
    { scale: 'major', d: [3, 0, 3, 0] }, { scale: 'major', d: [0, 3, 5, 2] }, { scale: 'lydian', d: [0, 1, 0, 1] },
    { scale: 'dorian', d: [0, 3, 0, 3] }, { scale: 'major', d: [3, 4, 2, 5] }] },
  { v: 'bluesy', l: 'BLUESY', p: [
    { scale: 'major', d: [0, 4, 3, 3, 0, 4, 0, 4], q: Array(8).fill('7') },
    { scale: 'major', d: [0, 3, 0, 4], q: Array(4).fill('7') },
    { scale: 'mixolydian', d: [0, 6, 3, 0] },
    { scale: 'dorian', d: [0, 3], q: ['m7', '7'] },
    { scale: 'major', d: [0, 0, 3, 3, 0, 0, 4, 3], q: Array(8).fill('7') }] },
  { v: 'tense', l: 'TENSE', p: [
    { scale: 'harmonic minor', d: [0, 6, 0, 6] }, { scale: 'phrygian', d: [0, 1] },
    { scale: 'minor', d: [0, 5, 1, 4], q: ['auto', 'auto', 'auto', 'maj'] },
    { scale: 'harmonic minor', d: [0, 3, 4, 4] }] },
];

export const chords = {
  type: 'chords',
  name: 'CHORDS',
  title: 'Chord Progression',
  category: 'Pitch',
  hp: 24,
  description: 'Chord progressions in one module, with two faces. BASIC needs no music theory: pick a MOOD and it loads a progression that fits, roll DICE for another one in the same mood, and keep rolling until you like it. ROOT moves it all higher or lower, CHORD sets how long each chord lasts. ADVANCED shows everything (the progression stays when you switch): each slot\'s knob picks the scale degree the chord is built on, stacked in key (the numeral above and the name below show what you get). Click a chord name to force a different type (MAJOR, MIN 7, SUS 4...), right-click to go back; AUTO follows the key, and SIZE makes AUTO chords triads, 7ths or 9ths. PRESETS loads a famous progression, LENGTH sets how many slots play. LEAD voice-leads: every chord takes the inversion closest to the one before, so the notes glide instead of jumping (INV turns the first chord over). VOICING spreads the notes: OPEN lifts the middle, SPREAD drops the lowest note an octave. Patch CHORD into a VOICE for a pad (all the notes at once), ROOT into a second VOICE or SUB DRONE for a bass line that always follows (BASS sets its octave). A rhythm into GATE turns the pad into stabs.',
  params: {
    face: { kind: 'switch', label: 'FACE', options: [{ v: 'basic', l: 'BASIC' }, { v: 'advanced', l: 'ADVANCED' }], default: 'basic' },
    mood: { kind: 'data', default: 'happy' },
    degrees: { kind: 'data', default: [0, 4, 5, 3, 0, 0, 0, 0], structural: true },
    quals: { kind: 'data', default: Array(CHORD_SLOTS).fill('auto'), structural: true },
    root: { kind: 'select', label: 'ROOT', options: ROOTS, default: 'C', structural: true },
    scale: { kind: 'select', label: 'SCALE', options: SCALES.map(([v, l]) => ({ v, l })), default: 'major', structural: true },
    size: { kind: 'rotary', label: 'SIZE', options: [{ v: 'triad', l: 'TRIAD' }, { v: 'sev', l: '7TH' }, { v: 'nine', l: '9TH' }], default: 'triad', size: 'sm', structural: true },
    voicing: { kind: 'rotary', label: 'VOICING', options: [{ v: 'close', l: 'CLOSE' }, { v: 'open', l: 'OPEN' }, { v: 'spread', l: 'SPREAD' }], default: 'close', size: 'sm', structural: true },
    rate: { kind: 'rotary', label: 'CHORD', options: ARP_RATES, default: 1, size: 'sm', structural: true },
    octave: { kind: 'knob', label: 'OCT', min: 1, max: 6, default: 3, step: 1, size: 'sm', structural: true },
    inv: { kind: 'knob', label: 'INV', min: 0, max: 3, default: 0, step: 1, size: 'sm', structural: true },
    bass: { kind: 'knob', label: 'BASS', min: 1, max: 4, default: 2, step: 1, size: 'sm', structural: true },
    length: { kind: 'knob', label: 'LENGTH', min: 1, max: CHORD_SLOTS, default: 4, step: 1, size: 'sm', structural: true },
    lead: { kind: 'toggle', label: 'LEAD', default: true, structural: true },
  },
  inputs: { gate: { type: 'rhythm', label: 'GATE' } },
  outputs: { root: { type: 'pitch', label: 'ROOT' }, chord: { type: 'pitch', label: 'CHORD' } },
  layout: [['face'], ['widget:chords'], ['widget:chordMoods'], ['root', 'scale', 'widget:chordPresets'], ['size', 'voicing', 'rate', 'octave', 'inv', 'bass', 'length'], ['lead', 'in:gate', 'out:root', 'out:chord']],
  compile(ctx) {
    const p = ctx.p;
    const plan = chordPlan(p);
    ctx.meta({ steps: p.length, dur: p.rate * p.length });
    const seqOf = (t) => (t.length === 1 ? t[0] : `<${t.join(' ')}>`);
    let chord = timed(fn('note', mini(seqOf(plan.map((c) => `[${c.notes.map(midiToNote).join(',')}]`)))), p.rate);
    const gate = ctx.in('gate');
    if (gate) chord = chord.call('struct', gate);
    const root = timed(fn('note', mini(seqOf(plan.map((c) => midiToNote(c.bass))))), p.rate);
    return { chord, root };
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
