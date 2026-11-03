// BONFIRE ONLY modules: their sound comes from Bonfire's own DSP (core/forge-audio.js), not from
// anything strudel.cc ships, so the generated code only plays inside Bonfire. They still take and
// give normal Strudel patterns, so MELODY/CHAIN/GATE in and FILTER/FX/MIXER out all work as usual.
// Every definition here sets `strudel: false`; the drawer, faceplate and compiler key off that.
import { registerControl } from '@strudel/core';
import { fn, mini, num } from '../core/expr.js';
import { midiToNote } from '../core/music.js';
import { setIf } from './helpers.js';

// Pattern methods for the custom sound's knobs (.strdecay(2) etc.). Registered at import, so the
// browser REPL and the Node test runner (same core instance) both know them.
for (const c of ['strdecay', 'strbright', 'strpick', 'growlwave', 'growlcut', 'growlres', 'growlfm', 'growlratio', 'growldec',
  'foldamt', 'foldsym', 'foldbloom', 'foldtime']) registerControl(c);

// Shared front half of every Bonfire-only voice: PITCH (or a C3 per bar) -> s(sound), GATE, TUNE.
function voiceStart(ctx, sound) {
  const pitch = ctx.in('pitch');
  const gate = ctx.in('gate');
  let e = (pitch ?? fn('note', mini(midiToNote(48)))).call('s', mini(sound));
  if (gate) e = e.call('struct', gate);
  return e.callIf(ctx.p.tune, 'transpose', num(ctx.p.tune));
}

// Shared back half: ATK (if any), REL, LEVEL, PAN.
function voiceEnd(ctx, e) {
  const p = ctx.p;
  if (p.attack != null) e = setIf(e, 'attack', p.attack, 0, 3);
  e = e.call('release', num(p.release, 3));
  e = setIf(e, 'gain', p.level, 1);
  const pan = ctx.in('pan');
  return pan ? e.call('pan', pan) : e;
}

const VOICE_INPUTS = {
  pitch: { type: 'pitch', label: 'PITCH' },
  gate: { type: 'rhythm', label: 'GATE' },
  pan: { type: 'cv', label: 'PAN' },
};

export const string = {
  type: 'string',
  name: 'STRING',
  title: 'Plucked String',
  category: 'Bonfire Only',
  strudel: false,
  hp: 12,
  description: 'A physically modelled plucked string (Karplus-Strong): a burst of noise bounces around a tiny delay loop and loses a bit of treble every pass, so it rings and fades like a real string. Great for bass guitar, harp, koto, muted plucks. DECAY = how long the string rings while the note is held. REL = how long it keeps ringing after the note ends (short = palm-muted, long = let it ring). BRIGHT = how much treble survives each bounce. PICK = soft thumb (low) or hard pick (high). Feed it PITCH and/or GATE like a VOICE. BONFIRE ONLY: this sound does not exist on strudel.cc.',
  params: {
    decay: { kind: 'knob', label: 'DECAY', min: 0.1, max: 10, default: 3, curve: 'pow', unit: 's' },
    bright: { kind: 'knob', label: 'BRIGHT', min: 0, max: 1, default: 0.5 },
    pick: { kind: 'knob', label: 'PICK', min: 0, max: 1, default: 0.6 },
    tune: { kind: 'knob', label: 'TUNE', min: -24, max: 24, default: 0, step: 1, size: 'sm', unit: 'st' },
    release: { kind: 'knob', label: 'REL', min: 0.02, max: 4, default: 0.3, size: 'sm', curve: 'pow', unit: 's' },
    level: { kind: 'knob', label: 'LEVEL', min: 0, max: 1.5, default: 1, size: 'sm' },
  },
  inputs: VOICE_INPUTS,
  outputs: { out: { type: 'pattern', label: 'OUT' } },
  layout: [['decay', 'bright', 'pick'], ['tune', 'release', 'level'], ['in:pitch', 'in:gate', 'in:pan', 'out:out']],
  compile(ctx) {
    const p = ctx.p;
    let e = voiceStart(ctx, 'bf_string');
    e = e.call('strdecay', num(p.decay, 2)).call('strbright', num(p.bright, 2)).call('strpick', num(p.pick, 2));
    return { out: voiceEnd(ctx, e) };
  },
};

export const growl = {
  type: 'growl',
  name: 'GROWL',
  title: 'Filter FM Voice',
  category: 'Bonfire Only',
  strudel: false,
  hp: 14,
  description: 'A saw or square through a resonant filter, with the filter\'s CUTOFF being shaken thousands of times a second by a second oscillator. Gentle settings give vowel-like "wow" tones; push FM and RES for snarls, growls and metallic screams (industrial, dubstep, EBM). CUTOFF = where the filter sits. RES = how much it rings. FM = how hard the cutoff gets shaken (in octaves). RATIO = how fast, compared to the note: 1 and 2 stay musical, odd values like 1.41 go clangy. FM DEC = the shake starts at FM and dies away over this time (0 = it never dies, a constant growl). Feed it PITCH and/or GATE like a VOICE. BONFIRE ONLY: this sound does not exist on strudel.cc.',
  params: {
    wave: { kind: 'switch', label: 'WAVE', options: [{ v: 'saw', l: 'SAW' }, { v: 'square', l: 'SQUARE' }], default: 'saw' },
    cutoff: { kind: 'knob', label: 'CUTOFF', min: 40, max: 8000, default: 400, curve: 'log', unit: 'Hz' },
    res: { kind: 'knob', label: 'RES', min: 0, max: 1, default: 0.6 },
    fm: { kind: 'knob', label: 'FM', min: 0, max: 6, default: 2 },
    ratio: { kind: 'knob', label: 'RATIO', min: 0.25, max: 8, default: 1, curve: 'pow', size: 'sm' },
    fmdec: { kind: 'knob', label: 'FM DEC', min: 0, max: 2, default: 0, curve: 'pow', size: 'sm', unit: 's' },
    tune: { kind: 'knob', label: 'TUNE', min: -24, max: 24, default: 0, step: 1, size: 'sm', unit: 'st' },
    attack: { kind: 'knob', label: 'ATK', min: 0, max: 2, default: 0, size: 'sm', curve: 'pow', unit: 's' },
    release: { kind: 'knob', label: 'REL', min: 0.005, max: 4, default: 0.1, size: 'sm', curve: 'pow', unit: 's' },
    level: { kind: 'knob', label: 'LEVEL', min: 0, max: 1.5, default: 1, size: 'sm' },
  },
  inputs: VOICE_INPUTS,
  outputs: { out: { type: 'pattern', label: 'OUT' } },
  layout: [['wave'], ['cutoff', 'res', 'fm'], ['ratio', 'fmdec', 'tune'], ['attack', 'release', 'level'], ['in:pitch', 'in:gate', 'in:pan', 'out:out']],
  compile(ctx) {
    const p = ctx.p;
    let e = voiceStart(ctx, 'bf_growl');
    if (p.wave === 'square') e = e.call('growlwave', num(1));
    e = e.call('growlcut', num(Math.round(p.cutoff))).call('growlres', num(p.res, 2)).call('growlfm', num(p.fm, 2))
      .call('growlratio', num(p.ratio, 3));
    e = setIf(e, 'growldec', p.fmdec, 0, 3);
    return { out: voiceEnd(ctx, e) };
  },
};

export const fold = {
  type: 'fold',
  name: 'FOLD',
  title: 'Wavefolder Voice',
  category: 'Bonfire Only',
  strudel: false,
  hp: 12,
  description: 'West-Coast style synthesis: a pure sine is pushed past its limits and FOLDED back on itself, again and again. Every fold adds new overtones, so FOLD sweeps from a soft flute-like sine to glassy, buzzy, bell-ish tones, without any filter. SYM tilts the folding off-centre for a hollower, reedier sound. BLOOM adds extra folding right at the start of each note that relaxes over TIME, so notes "pop" bright and then mellow out (short TIME = plucky bongo / marimba, long TIME = slow brass swell). Feed it PITCH and/or GATE like a VOICE. BONFIRE ONLY: this sound does not exist on strudel.cc.',
  params: {
    fold: { kind: 'knob', label: 'FOLD', min: 0, max: 10, default: 2 },
    sym: { kind: 'knob', label: 'SYM', min: -1, max: 1, default: 0 },
    bloom: { kind: 'knob', label: 'BLOOM', min: 0, max: 10, default: 3 },
    time: { kind: 'knob', label: 'TIME', min: 0.01, max: 3, default: 0.2, curve: 'pow', size: 'sm', unit: 's' },
    tune: { kind: 'knob', label: 'TUNE', min: -24, max: 24, default: 0, step: 1, size: 'sm', unit: 'st' },
    attack: { kind: 'knob', label: 'ATK', min: 0, max: 2, default: 0, size: 'sm', curve: 'pow', unit: 's' },
    release: { kind: 'knob', label: 'REL', min: 0.005, max: 4, default: 0.2, size: 'sm', curve: 'pow', unit: 's' },
    level: { kind: 'knob', label: 'LEVEL', min: 0, max: 1.5, default: 1, size: 'sm' },
  },
  inputs: VOICE_INPUTS,
  outputs: { out: { type: 'pattern', label: 'OUT' } },
  layout: [['fold', 'sym', 'bloom'], ['time', 'tune', 'attack'], ['release', 'level'], ['in:pitch', 'in:gate', 'in:pan', 'out:out']],
  compile(ctx) {
    const p = ctx.p;
    let e = voiceStart(ctx, 'bf_fold');
    e = e.call('foldamt', num(p.fold, 2));
    e = setIf(e, 'foldsym', p.sym, 0, 2);
    e = setIf(e, 'foldbloom', p.bloom, 0, 2);
    if (p.bloom) e = e.call('foldtime', num(p.time, 3));
    return { out: voiceEnd(ctx, e) };
  },
};
