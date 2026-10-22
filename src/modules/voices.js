// Sound makers: VOICE (synth / sample), SUB DRONE (sub + reese bass), THEREMIN (gliding sine lead),
// SAMPLER (one-shot / loop / slice) and CHOPPER (a step sequencer that picks a slice of the sample per step).
import { fn, mini, num } from '../core/expr.js';
import { BANKS, DRUM_SOUNDS, WAVES, bankLabel, isPitched, midiToNote } from '../core/music.js';
import { setIf, stepToken, timed } from './helpers.js';

function envelope(e, p) {
  e = setIf(e, 'attack', p.attack, 0);
  e = setIf(e, 'decay', p.decay, 0);
  e = setIf(e, 'sustain', p.sustain, 1);
  e = setIf(e, 'release', p.release, 0);
  return e;
}

export const voice = {
  type: 'voice',
  name: 'VOICE',
  title: 'Sound Generator',
  category: 'Sound',
  hp: 12,
  description: 'The thing that makes noise. SYNTH plays an oscillator, SAMPLE plays any sound from the library. Feed it PITCH (notes) and/or GATE (a rhythm). With nothing patched it plays one note per bar. REL is how long a note rings after it ends; at 0 a SAMPLE plays all the way to its end, which is fine for drums but piles up fast with long sounds like pianos.',
  params: {
    mode: { kind: 'switch', label: 'MODE', options: [{ v: 'synth', l: 'SYNTH' }, { v: 'sample', l: 'SAMPLE' }], default: 'synth', structural: true },
    wave: { kind: 'rotary', label: 'WAVE', options: WAVES.map(([v, l]) => ({ v, l })), default: 'sawtooth', structural: true },
    sound: { kind: 'sound', label: 'SAMPLE', default: 'piano', structural: true },
    bank: { kind: 'select', label: 'BANK', options: BANKS.map((b) => ({ v: b, l: bankLabel(b) })), default: '', structural: true },
    tune: { kind: 'knob', label: 'TUNE', min: -24, max: 24, default: 0, step: 1, unit: 'st' },
    attack: { kind: 'knob', label: 'ATK', min: 0, max: 2, default: 0, size: 'sm', curve: 'pow', unit: 's' },
    decay: { kind: 'knob', label: 'DEC', min: 0, max: 2, default: 0, size: 'sm', curve: 'pow', unit: 's' },
    sustain: { kind: 'knob', label: 'SUS', min: 0, max: 1, default: 1, size: 'sm' },
    // not 0: in SAMPLE mode REL 0 lets every note ring to the end of its sample, and long
    // samples (pianos ring ~25s) stack up to the 128-voice cap and choke the CPU
    release: { kind: 'knob', label: 'REL', min: 0, max: 4, default: 0.5, size: 'sm', curve: 'pow', unit: 's' },
    level: { kind: 'knob', label: 'LEVEL', min: 0, max: 1.5, default: 1, size: 'sm' },
  },
  inputs: {
    pitch: { type: 'pitch', label: 'PITCH' },
    gate: { type: 'rhythm', label: 'GATE' },
    pan: { type: 'cv', label: 'PAN' },
  },
  outputs: { out: { type: 'pattern', label: 'OUT' } },
  layout: [['mode'], ['wave', 'tune', 'level'], ['sound'], ['bank'], ['attack', 'decay', 'sustain', 'release'], ['in:pitch', 'in:gate', 'in:pan', 'out:out']],
  compile(ctx) {
    const p = ctx.p;
    const sound = p.mode === 'synth' ? p.wave : p.sound;
    const pitched = p.mode === 'synth' || isPitched(sound);
    const pitch = ctx.in('pitch');
    const gate = ctx.in('gate');
    let e;
    if (pitch) {
      e = pitch.call('s', mini(sound));
      if (gate) e = e.call('struct', gate);
      e = e.callIf(p.tune, 'transpose', num(p.tune));
    } else if (pitched) {
      e = fn('note', mini(midiToNote(48 + p.tune))).call('s', mini(sound));
      if (gate) e = e.call('struct', gate);
    } else {
      e = fn('s', mini(sound));
      if (gate) e = e.call('struct', gate);
      e = e.callIf(p.tune, 'speed', num(2 ** (p.tune / 12)));
    }
    if (p.mode === 'sample' && p.bank && DRUM_SOUNDS.includes(sound)) e = e.call('bank', mini(p.bank));
    e = envelope(e, p);
    e = setIf(e, 'gain', p.level, 1);
    const pan = ctx.in('pan');
    if (pan) e = e.call('pan', pan);
    return { out: e };
  },
};

// SUB DRONE: Moog-Taurus-style deep bass. A sine for weight plus a 2-voice supersaw detuned
// against itself (the Reese beat). Only the Reese is filtered, so the sub stays solid. DRIFT uses
// superdough's in-note filter LFO (lpsync/lpdepth): pattern-driven .lpf() is sampled once per note
// and would never move inside a held drone; this one sweeps continuously, locked to song time.
// OSC CURSES swaps the saws for strudel.cc's wt_digital_curses wavetable (same unison/detune), and
// DRIFT then also scans its table position with the same synced LFO (wtsync/wtdepth).
// SPEED below 1 BAR turns DRIFT into a tempo-locked wobble.
const DRIFT_RATES = [
  { v: 1 / 16, l: '1/16' }, { v: 1 / 8, l: '1/8' }, { v: 1 / 4, l: '1/4' }, { v: 1 / 2, l: '1/2' },
  { v: 1, l: '1 BAR' }, { v: 2, l: '2 BAR' }, { v: 4, l: '4 BAR' }, { v: 8, l: '8 BAR' }, { v: 16, l: '16 BAR' },
];
const DRONE_OSCS = { saw: 'supersaw', curses: 'wt_digital_curses' };

export const drone = {
  type: 'drone',
  name: 'SUB DRONE',
  title: 'Deep Bass Drone',
  category: 'Sound',
  hp: 14,
  description: 'Huge, slow, deep bass in the spirit of the Moog Taurus bass pedals. SUB is a pure sine you feel more than hear; REESE is two saws detuned against each other, so they beat and swirl (0 = one plain saw). OSC CURSES swaps the saws for a gnarly digital wavetable; REESE still detunes it, and DRIFT also scans through the table. TONE is a lowpass on the REESE (the SUB stays clean), and DRIFT slowly sweeps it open and shut, even inside one long held note (SPEED = how long one sweep takes; below 1 BAR it becomes a dubstep wobble). DRIVE adds grit. Feed it PITCH (a MELODY on a slow clock works great) and/or GATE; with nothing patched it holds a low C for 4 bars at a time. Long ATK / REL make it swell and fade.',
  params: {
    osc: { kind: 'switch', label: 'OSC', options: [{ v: 'saw', l: 'SAW' }, { v: 'curses', l: 'CURSES' }], default: 'saw', structural: true },
    sub: { kind: 'knob', label: 'SUB', min: 0, max: 1, default: 0.6 },
    reese: { kind: 'knob', label: 'REESE', min: 0, max: 1, default: 0.35 },
    tone: { kind: 'knob', label: 'TONE', min: 40, max: 5000, default: 350, curve: 'log', unit: 'Hz' },
    res: { kind: 'knob', label: 'RES', min: 0, max: 20, default: 3, size: 'sm' },
    drift: { kind: 'knob', label: 'DRIFT', min: 0, max: 1, default: 0.5, size: 'sm' },
    rate: { kind: 'rotary', label: 'SPEED', options: DRIFT_RATES, default: 4, size: 'sm', structural: true },
    drive: { kind: 'knob', label: 'DRIVE', min: 0, max: 0.95, default: 0.3, size: 'sm' },
    tune: { kind: 'knob', label: 'TUNE', min: -24, max: 24, default: 0, step: 1, size: 'sm', unit: 'st' },
    attack: { kind: 'knob', label: 'ATK', min: 0, max: 4, default: 0.4, size: 'sm', curve: 'pow', unit: 's' },
    release: { kind: 'knob', label: 'REL', min: 0, max: 6, default: 1.5, size: 'sm', curve: 'pow', unit: 's' },
    level: { kind: 'knob', label: 'LEVEL', min: 0, max: 1.5, default: 1, size: 'sm' },
  },
  inputs: {
    pitch: { type: 'pitch', label: 'PITCH' },
    gate: { type: 'rhythm', label: 'GATE' },
  },
  outputs: { out: { type: 'pattern', label: 'OUT' } },
  layout: [['osc'], ['sub', 'tone', 'reese'], ['res', 'drift', 'rate', 'drive'], ['tune', 'attack', 'release', 'level'], ['in:pitch', 'in:gate', 'out:out']],
  compile(ctx) {
    const p = ctx.p;
    const pitch = ctx.in('pitch');
    const gate = ctx.in('gate');
    // no PITCH: a low C held for 4 bars (or struck by GATE)
    let src = pitch ?? fn('note', mini('c2'));
    if (gate) src = src.call('struct', gate);
    else if (!pitch) src = src.call('slow', num(4));
    src = src.callIf(p.tune, 'transpose', num(p.tune));
    // 2 voices detuned: detune = total spread in semitones, so 0.35 -> ~18 cents of beating
    const curses = p.osc === 'curses';
    let reese = src.call('s', mini(curses || p.reese > 0.005 ? DRONE_OSCS[p.osc] : 'sawtooth'));
    if (p.reese > 0.005) reese = reese.call('unison', num(2)).call('detune', num(p.reese * 0.5, 3));
    reese = reese.call('lpf', num(Math.round(p.tone), 0));
    reese = setIf(reese, 'lpq', p.res, 0, 1);
    // LFO swings the cutoff +-(depth / 2) * TONE, one cycle every SPEED bars
    if (p.drift > 0.005) {
      reese = reese.call('lpsync', num(1 / p.rate, 4)).call('lpdepth', num(p.drift * 1.8, 2)).call('lpshape', mini('sine'));
      // table position scans 0..DRIFT with the same synced LFO
      if (curses) reese = reese.call('wtsync', num(1 / p.rate, 4)).call('wtdepth', num(p.drift, 2)).call('wtshape', mini('sine'));
    }
    const layers = [reese];
    if (p.sub > 0.005) layers.push(setIf(src.call('s', mini('sine')), 'velocity', p.sub * 1.4, 1, 2));
    let e = layers.length === 1 ? layers[0] : fn('stack', ...layers);
    // superdough's synth sustain defaults below 1; a drone holds
    e = e.call('sustain', num(1));
    e = setIf(e, 'attack', p.attack, 0);
    e = setIf(e, 'release', p.release, 0);
    e = setIf(e, 'shape', p.drive, 0, 2);
    e = setIf(e, 'gain', p.level, 1);
    ctx.meta({ rate: p.rate });
    return { out: e };
  },
};

// THEREMIN: superdough has no portamento, so every note gets a pitch envelope that starts at the
// note before it and ramps to its own pitch over GLIDE seconds (penv = the jump in semitones,
// panchor 1 = the ramp ends on the note). Finding "the note before" needs the pitch pattern itself,
// so a registered helper looks up to 4 cycles back from each onset. It is plain Strudel, so the code
// still runs on strudel.cc. Notes overlap by REL, which hides the restart of each oscillator.
const GLIDE_HELPER = `// THEREMIN glide: each note slides in from the note before it
register('glide', (pat) => pat.withHap((h) => {
  if (!h.whole) return h
  const b = h.whole.begin.valueOf()
  const midi = (n) => (typeof n === 'number' ? n : noteToMidi(n))
  let prev = null
  for (const x of pat.queryArc(b - 4, b)) {
    if (x.whole && x.whole.begin < b && x.value.note != null && (!prev || x.whole.begin > prev.whole.begin)) prev = x
  }
  return h.withValue((v) => ({ ...v, penv: prev && v.note != null ? midi(v.note) - midi(prev.value.note) : 0 }))
}))`;
// HOLD NEXT: a theremin never stops between notes, so each note rings until the next one starts
// (value.duration overrides the hap's own length; nothing ahead within 4 cycles = keep its length).
const HOLD_HELPER = `// THEREMIN hold: each note rings until the next one starts
register('holdNext', (pat) => pat.withHap((h) => {
  if (!h.whole) return h
  const b = h.whole.begin.valueOf()
  let next = null
  for (const x of pat.queryArc(b, b + 4)) {
    const t = x.whole ? x.whole.begin.valueOf() : null
    if (t != null && t > b && (next == null || t < next)) next = t
  }
  return next == null ? h : h.withValue((v) => ({ ...v, duration: next - b }))
}))`;
const THEREMIN_WAVES = [{ v: 'sine', l: 'PURE' }, { v: 'triangle', l: 'WARM' }, { v: 'sawtooth', l: 'REED' }];

export const theremin = {
  type: 'theremin',
  name: 'THEREMIN',
  title: 'Gliding Sci-Fi Lead',
  category: 'Sound',
  hp: 14,
  description: 'The spooky sliding sound of 1950s sci-fi films. Every note glides into the next one instead of jumping (GLIDE = how long the slide takes), and a hand-shake VIBRATO wobbles the pitch (RATE = how fast, DEPTH = how wide). PURE is a clean sine, WARM is a soft triangle, REED is a buzzier, filtered saw. Long ATK makes notes swell in like a hand moving toward the volume antenna. Feed it PITCH from a MELODY, CHAIN or ARP; it is made for one note at a time, so chords sound odd. Rests in the melody stop the sound, and the next note still slides in from the last one. HOLD NEXT plays it like the real instrument: every note rings until the next one starts, so a MELODY step becomes a long held note and rests just make it longer. With nothing patched it plays a short eerie phrase.',
  params: {
    wave: { kind: 'switch', label: 'WAVE', options: THEREMIN_WAVES, default: 'sine', structural: true },
    hold: { kind: 'switch', label: 'HOLD', options: [{ v: 'note', l: 'NOTE' }, { v: 'next', l: 'NEXT' }], default: 'note', structural: true },
    glide: { kind: 'knob', label: 'GLIDE', min: 0, max: 1, default: 0.15, curve: 'pow', unit: 's' },
    vib: { kind: 'knob', label: 'RATE', min: 0, max: 10, default: 5.5, unit: 'Hz' },
    depth: { kind: 'knob', label: 'DEPTH', min: 0, max: 1, default: 0.2, unit: 'st' },
    tune: { kind: 'knob', label: 'TUNE', min: -24, max: 24, default: 0, step: 1, size: 'sm', unit: 'st' },
    attack: { kind: 'knob', label: 'ATK', min: 0, max: 2, default: 0.08, size: 'sm', curve: 'pow', unit: 's' },
    release: { kind: 'knob', label: 'REL', min: 0, max: 3, default: 0.4, size: 'sm', curve: 'pow', unit: 's' },
    drive: { kind: 'knob', label: 'DRIVE', min: 0, max: 0.9, default: 0, size: 'sm' },
    level: { kind: 'knob', label: 'LEVEL', min: 0, max: 1.5, default: 0.8, size: 'sm' },
  },
  inputs: {
    pitch: { type: 'pitch', label: 'PITCH' },
    gate: { type: 'rhythm', label: 'GATE' },
    vol: { type: 'cv', label: 'VOL' },
  },
  outputs: { out: { type: 'pattern', label: 'OUT' } },
  layout: [['wave', 'hold'], ['glide', 'vib', 'depth'], ['tune', 'attack', 'release', 'drive'], ['level', 'in:pitch', 'in:gate', 'in:vol', 'out:out']],
  compile(ctx) {
    const p = ctx.p;
    let e = ctx.in('pitch') ?? fn('note', mini('g4 c5 eb5 d5 c5 g4 ab4 g4')).call('slow', num(2));
    const gate = ctx.in('gate');
    if (gate) e = e.call('struct', gate);
    if (p.hold === 'next') {
      ctx.prelude('holdNext', HOLD_HELPER);
      e = e.call('holdNext');
    }
    if (p.glide > 0.005) {
      ctx.prelude('glide', GLIDE_HELPER);
      e = e.call('glide').call('pattack', num(p.glide, 3)).call('pdecay', num(0)).call('psustain', num(1)).call('panchor', num(1));
    }
    e = e.callIf(p.tune, 'transpose', num(p.tune));
    e = e.call('s', mini(p.wave));
    if (p.wave === 'sawtooth') e = e.call('lpf', num(1600, 0));
    if (p.vib > 0.05 && p.depth > 0.005) e = e.call('vib', num(p.vib, 2)).call('vibmod', num(p.depth, 2));
    // superdough's synth sustain defaults below 1; a theremin holds
    e = e.call('sustain', num(1));
    e = setIf(e, 'attack', p.attack, 0);
    e = setIf(e, 'release', p.release, 0);
    e = setIf(e, 'shape', p.drive, 0, 2);
    e = setIf(e, 'gain', p.level, 1);
    const vol = ctx.in('vol');
    if (vol) e = e.call('velocity', vol.call('range', num(0.1), num(1)));
    return { out: e };
  },
};

const ORDERS = [{ v: 'fwd', l: 'FWD' }, { v: 'rev', l: 'REV' }, { v: 'rand', l: 'RAND' }];

export const sampler = {
  type: 'sampler',
  name: 'SAMPLER',
  title: 'Sample Player',
  category: 'Sound',
  hp: 12,
  description: 'Deep sample player. ONE plays the sample per GATE hit, LOOP stretches it to BARS, SLICE cuts it into pieces and replays them in order, backwards or shuffled. Drop any sound from the SAMPLES tab onto its display.',
  params: {
    sound: { kind: 'sound', label: 'SAMPLE', default: 'brk', structural: true },
    n: { kind: 'knob', label: 'VARIANT', min: 0, max: 15, default: 0, step: 1, size: 'sm', structural: true },
    mode: { kind: 'switch', label: 'MODE', options: [{ v: 'one', l: 'ONE' }, { v: 'loop', l: 'LOOP' }, { v: 'slice', l: 'SLICE' }], default: 'loop', structural: true },
    bars: { kind: 'knob', label: 'BARS', min: 1, max: 8, default: 1, step: 1, size: 'sm', structural: true },
    slices: { kind: 'knob', label: 'SLICES', min: 2, max: 32, default: 8, step: 1, size: 'sm', structural: true },
    order: { kind: 'switch', label: 'ORDER', options: ORDERS, default: 'fwd', structural: true },
    begin: { kind: 'knob', label: 'BEGIN', min: 0, max: 1, default: 0, size: 'sm' },
    end: { kind: 'knob', label: 'END', min: 0, max: 1, default: 1, size: 'sm' },
    speed: { kind: 'knob', label: 'SPEED', min: -2, max: 2, default: 1, size: 'sm' },
    level: { kind: 'knob', label: 'LEVEL', min: 0, max: 1.5, default: 1, size: 'sm' },
  },
  inputs: { gate: { type: 'rhythm', label: 'GATE' }, pan: { type: 'cv', label: 'PAN' } },
  outputs: { out: { type: 'pattern', label: 'OUT' } },
  layout: [['sound'], ['mode'], ['n', 'bars', 'slices'], ['order'], ['begin', 'end', 'speed', 'level'], ['in:gate', 'in:pan', 'out:out']],
  compile(ctx) {
    const p = ctx.p;
    let e = fn('s', mini(p.sound)).callIf(p.n, 'n', num(p.n));
    if (p.mode === 'loop') {
      e = e.call('loopAt', num(p.bars));
    } else if (p.mode === 'slice') {
      const n = num(p.slices);
      const order = p.order === 'rev' ? fn('run', n).call('rev')
        : p.order === 'rand' ? fn('irand', n).call('segment', n) : fn('run', n);
      e = e.call('splice', n, order).callIf(p.bars !== 1, 'slow', num(p.bars));
    } else {
      const gate = ctx.in('gate');
      if (gate) e = e.call('struct', gate);
    }
    e = setIf(e, 'begin', p.begin, 0);
    e = setIf(e, 'end', p.end, 1);
    e = setIf(e, 'speed', p.speed, 1, 2);
    e = setIf(e, 'gain', p.level, 1);
    const pan = ctx.in('pan');
    if (pan) e = e.call('pan', pan);
    return { out: e };
  },
};

// CHOPPER: MELODY's step lane, but every step picks a slice of the sample instead of a note.
export const CHOP_STEPS = 16;
export const CHOP_MAX_SLICES = 32;

export const chopper = {
  type: 'chopper',
  name: 'CHOPPER',
  title: 'Slice Sequencer',
  category: 'Sound',
  hp: 18,
  description: 'Chops a sample into equal SLICES and plays them in any order you like: each step picks which slice plays. Click a step\'s button to play / rest it, right-click it for a ×2 / ×4 roll. CUT stops each slice when its step ends, RING lets it play out. LENGTH sets how many steps play (the second row appears past 8). Drop any sound from the SAMPLES tab onto its display.',
  params: {
    sound: { kind: 'sound', label: 'SAMPLE', default: 'brk', structural: true },
    n: { kind: 'knob', label: 'VARIANT', min: 0, max: 15, default: 0, step: 1, size: 'sm', structural: true },
    slices: { kind: 'knob', label: 'SLICES', min: 2, max: CHOP_MAX_SLICES, default: 8, step: 1, size: 'sm', structural: true },
    length: { kind: 'knob', label: 'LENGTH', min: 1, max: CHOP_STEPS, default: 8, step: 1, size: 'sm', structural: true },
    // which slice each step plays (0 = the first); a step past SLICES plays the last slice
    picks: { kind: 'data', default: [0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 2, 3, 4, 5, 6, 7], structural: true },
    // 0 rest, 1 play, 2 = x2 roll, 3 = x4 roll (same states as SEQ-16)
    gates: { kind: 'data', default: Array(CHOP_STEPS).fill(1), structural: true },
    tail: { kind: 'switch', label: 'TAIL', options: [{ v: 'cut', l: 'CUT' }, { v: 'ring', l: 'RING' }], default: 'cut', structural: true },
    speed: { kind: 'knob', label: 'SPEED', min: -2, max: 2, default: 1, size: 'sm' },
    level: { kind: 'knob', label: 'LEVEL', min: 0, max: 1.5, default: 1, size: 'sm' },
  },
  inputs: { clk: { type: 'clock', label: 'CLK' } },
  outputs: { out: { type: 'pattern', label: 'OUT' } },
  layout: [['widget:chopper'], ['sound'], ['n', 'slices', 'length', 'tail'], ['speed', 'level', 'in:clk', 'out:out']],
  compile(ctx) {
    const { sound, n, slices, length, picks, gates, tail, speed, level } = ctx.p;
    const dur = (ctx.in('clk') ?? 1 / 8) * length;
    ctx.meta({ steps: length, dur });
    const tokens = [];
    for (let i = 0; i < length; i++) tokens.push(stepToken(gates[i] ?? 0, String(Math.min(picks[i] ?? 0, slices - 1))));
    if (!tokens.some((t) => t !== '~')) return { out: null };
    let e = fn('s', mini(sound)).callIf(n, 'n', num(n)).call('slice', num(slices), mini(tokens.join(' ')));
    e = timed(e, dur);
    if (tail === 'cut') e = e.call('clip', num(1));
    e = setIf(e, 'speed', speed, 1, 2);
    e = setIf(e, 'gain', level, 1);
    return { out: e };
  },
};
