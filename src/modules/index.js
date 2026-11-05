// Module registry. Every module follows the ModuleDefinition shape:
// { type, name, title, category, hp, description, params, inputs, outputs,
//   layout, compile(ctx) -> { [outputId]: value } }
// See README.md "Writing a module" for the full contract.
import { arp, beats, chain, chords, clock, euclid, melody, octave, seq } from './sources.js';
import { chopper, drone, sampler, theremin, voice } from './voices.js';
import { acid, drum, fold, grain, growl, hoover, modal, string } from './forge.js';
import { duck, fenv, filter, fx, khaoz, lfo, mixer, output, tape, vandal, vintage } from './processors.js';

export const MODULES = Object.fromEntries(
  [clock, chain, seq, beats, euclid, melody, arp, chords, octave, voice, drone, theremin, sampler, chopper, vandal, filter, fenv, fx, vintage, tape, lfo, khaoz, duck, mixer, output, string, growl, fold, acid, modal, hoover, drum, grain].map((m) => [m.type, m]),
);

export const CATEGORY_ORDER = ['Time', 'Rhythm', 'Pitch', 'Sound', 'Mangle', 'Shape', 'Modulate', 'Mix', 'Bonfire Only'];

// Modules with `strudel: false` make sounds strudel.cc doesn't have (Bonfire's own DSP).
export const isStrudel = (type) => MODULES[type]?.strudel !== false;

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
