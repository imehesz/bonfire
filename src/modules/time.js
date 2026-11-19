// Slow-time processors for ambient work: TIDE (stretch a chain without touching the CLOCK)
// and DRIFT (Eno-style tape loops: every slice of the bar on its own prime-length loop).
import { fn, lambda, mini, num, printExpr, raw } from '../core/expr.js';

const barSeconds = (bpm) => 240 / (bpm || 120); // setcpm(bpm/4): one cycle = one 4/4 bar

// ---------------------------------------------------------------- TIDE

export const TIDE_SLOWS = [1, 2, 3, 4, 6, 8, 12, 16];
const STRETCHED = ['attack', 'decay', 'release'];

export const tide = {
  type: 'tide',
  name: 'TIDE',
  title: 'Slow Time',
  category: 'Time',
  hp: 8,
  description: 'Slows one chain down while the CLOCK keeps its tempo, so the drums can stay fast while a pad crawls. SLOW is how many bars one bar of the input now takes (/4 = four times slower). Put it after a VOICE. STRETCH also makes the sound\'s own ATK / DEC / REL that much longer, so slowed notes still swell and fade instead of plucking. SWELL and TAIL set the fade-in and fade-out yourself, in bars of the CLOCK (0 = leave them alone); they follow the tempo. The screen shows where you are in the slowed loop.',
  params: {
    slow: { kind: 'rotary', label: 'SLOW', options: TIDE_SLOWS.map((v) => ({ v, l: v === 1 ? 'x1' : `/${v}` })), default: 4, size: 'lg', structural: true },
    swell: { kind: 'knob', label: 'SWELL', min: 0, max: 4, default: 0, size: 'sm', curve: 'pow', unit: 'bar' },
    tail: { kind: 'knob', label: 'TAIL', min: 0, max: 8, default: 0, size: 'sm', curve: 'pow', unit: 'bar' },
    stretch: { kind: 'switch', label: 'STRETCH', options: [{ v: 'off', l: 'OFF' }, { v: 'on', l: 'ON' }], default: 'on', structural: true },
  },
  inputs: { in: { type: 'pattern', label: 'IN' } },
  outputs: { out: { type: 'pattern', label: 'OUT' } },
  layout: [['widget:tideWave'], ['slow'], ['swell', 'tail'], ['stretch'], ['in:in', 'out:out']],
  compile(ctx) {
    let e = ctx.in('in');
    if (!e) return { out: null };
    const p = ctx.p;
    const n = p.slow;
    ctx.meta({ slow: n });
    if (p.stretch === 'on' && n > 1) {
      // only multiply what the chain already sets: mul(attack(n)) on a sound without an
      // attack would SET attack to n seconds
      // (SWELL / TAIL replace attack / release outright, so those need no stretching)
      const src = printExpr(e);
      const own = { attack: p.swell >= 0.01, release: p.tail >= 0.01 };
      for (const k of STRETCHED) if (!own[k] && new RegExp(`\\.${k}\\(`).test(src)) e = e.call('mul', fn(k, num(n)));
    }
    e = e.callIf(n > 1, 'slow', num(n));
    const bar = barSeconds(ctx.global.bpm);
    e = e.callIf(p.swell >= 0.01, 'attack', num(p.swell * bar, 2));
    e = e.callIf(p.tail >= 0.01, 'release', num(p.tail * bar, 2));
    return { out: e };
  },
};

// ---------------------------------------------------------------- DRIFT

export const DRIFT_LOOPS = {
  short: { l: 'SHORT', bars: [2, 3, 5, 7, 11, 13, 17, 19] },
  mid: { l: 'MID', bars: [3, 5, 7, 11, 13, 17, 19, 23] },
  long: { l: 'LONG', bars: [5, 7, 11, 13, 17, 19, 23, 29] },
};
// FREE: each loop is a few 16ths longer than whole bars, so its slice slides across the bar
// (still on the 16th grid)
const FREE_NUDGE = [0.25, 0.5, 0.75, 0.375, 0.625, 0.125, 0.875, 0.1875];
const DRIFT_VOICES = [2, 3, 4, 6, 8];

export function driftLoops(p) {
  const bars = (DRIFT_LOOPS[p.loops] ?? DRIFT_LOOPS.mid).bars.slice(0, p.voices);
  return p.grid === 'free' ? bars.map((b, i) => b + FREE_NUDGE[i]) : bars;
}

const gcd = (a, b) => (b ? gcd(b, a % b) : a);
// bars until every loop lines up again
export function driftRepeat(loops) {
  const q = loops.map((l) => Math.round(l * 16));
  return q.reduce((a, b) => (a / gcd(a, b)) * b, 1) / 16;
}

// voices alternate right / left, the longer loops further out (WIDTH 1 = the outer pair hard L/R)
function driftPan(i, n, width) {
  const mag = (Math.floor(i / 2) + 1) / Math.ceil(n / 2);
  return 0.5 + (i % 2 ? -1 : 1) * mag * width * 0.5;
}

export const drift = {
  type: 'drift',
  name: 'DRIFT',
  title: 'Tape Loop Drift',
  category: 'Time',
  hp: 12,
  description: 'The Music for Airports trick. DRIFT cuts each bar of what you feed it into VOICES slices and puts every slice on its own loop: one comes back every 3 bars, the next every 5, then 7, 11... (prime numbers, so they almost never line up). Bar 1 plays your whole part, after that it falls apart into a slow, ever-changing texture that is still locked to the CLOCK. Put it after a VOICE, best fed by a MELODY with notes spread over the bar and a long REL. LOOPS picks how long the loops are (SHORT = busier, LONG = sparser). GRID BAR keeps every slice where it was in the bar; FREE makes each loop a little longer than whole bars, so the slices slide around the bar too. WIDTH spreads the voices across the stereo field. Each lane on the screen is one loop: the dot lights up when it plays. The top line says how long until the whole thing repeats.',
  params: {
    voices: { kind: 'rotary', label: 'VOICES', options: DRIFT_VOICES.map((v) => ({ v, l: String(v) })), default: 4, structural: true },
    loops: { kind: 'rotary', label: 'LOOPS', options: Object.entries(DRIFT_LOOPS).map(([v, o]) => ({ v, l: o.l })), default: 'mid', structural: true },
    grid: { kind: 'switch', label: 'GRID', options: [{ v: 'bar', l: 'BAR' }, { v: 'free', l: 'FREE' }], default: 'bar', structural: true },
    width: { kind: 'knob', label: 'WIDTH', min: 0, max: 1, default: 0.6, structural: true },
  },
  inputs: { in: { type: 'pattern', label: 'IN' } },
  outputs: { out: { type: 'pattern', label: 'OUT' } },
  layout: [['widget:driftLanes'], ['voices', 'loops'], ['grid', 'width'], ['in:in', 'out:out']],
  compile(ctx) {
    const e = ctx.in('in');
    if (!e) return { out: null };
    const p = ctx.p;
    const n = p.voices;
    const loops = driftLoops(p);
    ctx.meta({ loops, repeat: driftRepeat(loops), bar: barSeconds(ctx.global.bpm) });
    const voices = loops.map((L, i) => lambda((x) => {
      const slice = Array.from({ length: n }, (_, j) => (j === i ? 1 : 0)).join(' ');
      let v;
      if (p.grid === 'free') {
        // slice i of input bar k plays at k*L: one bar of it, then L-1 bars of silence
        const part = printExpr(x.call('mask', mini(`[${slice}]`)));
        v = fn('timeCat', raw(`[1, ${part}]`), raw(`[${num(L - 1, 4).text}, silence]`)).call('slow', num(L, 4));
      } else {
        // slice i of the current bar, on every L-th bar
        v = x.call('mask', mini(`<[${slice}] 0!${L - 1}>`));
      }
      return p.width > 0.005 ? v.call('pan', num(driftPan(i, n, p.width), 2)) : v;
    }));
    return { out: e.call('layer', ...voices) };
  },
};
