// Sound makers: VOICE (synth / sample), SUB DRONE (sub + reese bass) and SAMPLER (one-shot / loop / slice).
import { fn, mini, num } from '../core/expr.js';
import { BANKS, DRUM_SOUNDS, WAVES, bankLabel, isPitched, midiToNote } from '../core/music.js';
import { setIf } from './helpers.js';

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

const ORDERS = [{ v: 'fwd', l: 'FWD' }, { v: 'rev', l: 'REV' }, { v: 'rand', l: 'RAND' }];

export const sampler = {
  type: 'sampler',
  name: 'SAMPLER',
  title: 'Sample Player',
  category: 'Sound',
  hp: 12,
  description: 'Deep sample player. ONE plays the sample per GATE hit, LOOP stretches it to BARS, SLICE cuts it into pieces and replays them in order, backwards or shuffled. Drop any sound from the SAMPLES drawer onto its display.',
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
