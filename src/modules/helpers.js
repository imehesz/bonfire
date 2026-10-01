import { Expr, num, raw } from '../core/expr.js';

// Stretch a pattern that spans one cycle to `total` cycles, with the
// friendliest spelling (fast(2) rather than slow(0.5)).
export function timed(expr, total) {
  if (!total || Math.abs(total - 1) < 1e-9) return expr;
  const inv = 1 / total;
  if (total < 1 && Math.abs(inv - Math.round(inv)) < 1e-9) return expr.call('fast', num(Math.round(inv)));
  return expr.call('slow', num(total, 4));
}

// A mini-notation literal that can take method calls: "x ~ x".slow(2)
export const miniExpr = (s) => new Expr(JSON.stringify(String(s)));

// Step state used by trigger sequencers: 0 rest, 1 trig, 2 = x2, 3 = x4.
export function stepToken(state, word) {
  if (state === 1) return word;
  if (state === 2) return `${word}*2`;
  if (state === 3) return `${word}*4`;
  return '~';
}

export const isDefault = (v, d, eps = 1e-6) => Math.abs(v - d) < eps;

// knob value -> code number, chained only when it differs from `neutral`
export function setIf(expr, name, value, neutral, digits = 3) {
  return isDefault(value, neutral) ? expr : expr.call(name, num(value, digits));
}

export { num, raw };

// Rate options shared by LFO / Vandalizer: value = speed multiplier.
export const RATES = [
  { v: 0.0625, l: '/16' }, { v: 0.125, l: '/8' }, { v: 0.25, l: '/4' }, { v: 0.5, l: '/2' },
  { v: 1, l: 'x1' }, { v: 2, l: 'x2' }, { v: 4, l: 'x4' }, { v: 8, l: 'x8' },
];

export function rated(expr, rate) {
  if (rate === 1) return expr;
  return rate > 1 ? expr.call('fast', num(rate)) : expr.call('slow', num(1 / rate));
}
