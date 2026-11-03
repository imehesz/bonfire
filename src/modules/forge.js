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
registerControl('strdecay');
registerControl('strbright');
registerControl('strpick');

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
  inputs: {
    pitch: { type: 'pitch', label: 'PITCH' },
    gate: { type: 'rhythm', label: 'GATE' },
    pan: { type: 'cv', label: 'PAN' },
  },
  outputs: { out: { type: 'pattern', label: 'OUT' } },
  layout: [['decay', 'bright', 'pick'], ['tune', 'release', 'level'], ['in:pitch', 'in:gate', 'in:pan', 'out:out']],
  compile(ctx) {
    const p = ctx.p;
    const pitch = ctx.in('pitch');
    const gate = ctx.in('gate');
    let e = (pitch ?? fn('note', mini(midiToNote(48)))).call('s', mini('bf_string'));
    if (gate) e = e.call('struct', gate);
    e = e.callIf(p.tune, 'transpose', num(p.tune));
    e = e.call('strdecay', num(p.decay, 2)).call('strbright', num(p.bright, 2)).call('strpick', num(p.pick, 2));
    e = e.call('release', num(p.release, 3));
    e = setIf(e, 'gain', p.level, 1);
    const pan = ctx.in('pan');
    if (pan) e = e.call('pan', pan);
    return { out: e };
  },
};
