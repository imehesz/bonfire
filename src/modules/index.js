// Module registry. Every module follows the ModuleDefinition shape:
// { type, name, title, category, hp, description, params, inputs, outputs,
//   layout, compile(ctx) -> { [outputId]: value } }
// See README.md "Writing a module" for the full contract.
import { arp, beats, chain, clock, euclid, melody, seq } from './sources.js';
import { drone, sampler, voice } from './voices.js';
import { duck, filter, fx, lfo, mixer, output, tape, vandal, vintage } from './processors.js';

export const MODULES = Object.fromEntries(
  [clock, chain, seq, beats, euclid, melody, arp, voice, drone, sampler, vandal, filter, fx, vintage, tape, lfo, duck, mixer, output].map((m) => [m.type, m]),
);

export const CATEGORY_ORDER = ['Time', 'Rhythm', 'Pitch', 'Sound', 'Mangle', 'Shape', 'Modulate', 'Mix'];

export function defaultParams(type) {
  const def = MODULES[type];
  const out = {};
  for (const [k, p] of Object.entries(def.params)) out[k] = structuredClone(p.default);
  return out;
}

// An output can feed an input of the same type; note patterns also play as sound.
export function compatible(outType, inType) {
  return outType === inType || (outType === 'pitch' && inType === 'pattern');
}
