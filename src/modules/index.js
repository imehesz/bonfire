// Module registry. Every module follows the ModuleDefinition shape:
// { type, name, title, category, hp, description, params, inputs, outputs,
//   layout, compile(ctx) -> { [outputId]: value } }
// See README.md "Writing a module" for the full contract.
import { beats, clock, euclid, melody, seq } from './sources.js';
import { sampler, voice } from './voices.js';
import { filter, fx, lfo, mixer, output, tape, vandal } from './processors.js';

export const MODULES = Object.fromEntries(
  [clock, seq, beats, euclid, melody, voice, sampler, vandal, filter, fx, tape, lfo, mixer, output].map((m) => [m.type, m]),
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
