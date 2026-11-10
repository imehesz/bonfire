// BONFIRE ONLY modules: their sound comes from Bonfire's own DSP (core/forge-audio.js), not from
// anything strudel.cc ships, so the generated code only plays inside Bonfire. They still take and
// give normal Strudel patterns, so MELODY/CHAIN/GATE in and FILTER/FX/MIXER out all work as usual.
// Every definition here sets `strudel: false`; the drawer, faceplate and compiler key off that.
import { Pattern, Hap, TimeSpan, noteToMidi, register, registerControl } from '@strudel/core';
import { fn, mini, num, str } from '../core/expr.js';
import { midiToNote } from '../core/music.js';
import { setIf } from './helpers.js';

// Pattern methods for the custom sound's knobs (.strdecay(2) etc.). Registered at import, so the
// browser REPL and the Node test runner (same core instance) both know them.
for (const c of ['strdecay', 'strbright', 'strpick', 'growlwave', 'growlcut', 'growlres', 'growlfm', 'growlratio', 'growldec',
  'foldamt', 'foldsym', 'foldbloom', 'foldtime',
  'acidwave', 'acidcut', 'acidres', 'acidenv', 'aciddec', 'acidacc', 'acidglide', 'acidpath',
  'modalmat', 'modalstrike', 'modalpos', 'modaldecay', 'modaldamp', 'modalstretch',
  'hoovmode', 'hoovdet', 'hoovmix', 'hoovwidth', 'hoovdip', 'hoovdiptime', 'hoovsub',
  'drummodel', 'drumkey', 'drumtune', 'drumpunch', 'drumdecay', 'drumtone', 'drumnoise', 'drumclick', 'drumdrive',
  'fmalgo', 'fmfb', 'fmsus', 'fmhold', 'fmchorus', 'fmbright', 'fmtime', 'fmmetal', 'fmsoft', 'fmacc',
  ...[0, 1, 2, 3].flatMap((i) => [`fmr${i}`, `fml${i}`, `fma${i}`, `fmd${i}`]),
  'bfin', 'bfpg', 'bfout', 'bfkind', 'fridgelvl', 'fridgesmooth', 'fridgetrig', 'fridgelen',
  'bfroom', 'bfdelay', 'stutfade', 'stuttrig', 'stutlen', 'stutdur',
  'mirmode', 'mirrate', 'mirdepth', 'mirwidth', 'mirlvl',
  'haloshim', 'halodecay', 'halosize', 'halotone', 'halopitch', 'halolvl',
  'grainsrc', 'grainn', 'graintune', 'grainpos', 'grainspray', 'grainscan', 'grainsize', 'graindens', 'grainshim', 'grainwidth']) registerControl(c);

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

// ---- ACID: 303-style mono bass with real slides ----
// A real slide needs ONE oscillator that keeps running from note to note, with no envelope restart.
// Bonfire voices are one audio node per note, so acidline() merges every run of slid notes into a
// single long note and hands the pitches along as `acidpath` ("when:midi:accent,..."; when = 0..1
// across the merged note). The worklet then glides between them. Which notes slide / get accents
// comes from a rhythm (a step that is on = slide out of / accent on the note starting there) or,
// with nothing patched, from a density + SEED: a fixed per-step choice, so the line repeats.
const LOOP = 2; // a slide run never crosses a 2-bar line, so every query agrees on where runs start

function hash01(t, seed, salt) {
  const pos = ((t % 1) + 1) % 1;
  const x = Math.sin(pos * 9301.71 + seed * 49.297 + salt * 233.3) * 43758.5453;
  return x - Math.floor(x);
}

const isOn = (v) => v != null && v !== 0 && v !== false && v !== '~' && v !== '0';

function midiOf(v) {
  if (typeof v.note === 'number') return v.note;
  if (typeof v.note === 'string') return noteToMidi(v.note);
  if (typeof v.freq === 'number') return 69 + 12 * Math.log2(v.freq / 440);
  return 36; // superdough's own fallback for a synth with no note
}

function flagAt(src, seed, salt) {
  if (typeof src.__pure === 'number') return (t) => hash01(t, seed, salt) < src.__pure;
  return (t) => src.queryArc(t, t + 1 / 65536).some((h) => h.whole && h.whole.begin.valueOf() <= t + 1e-9 && isOn(h.value));
}

function acidLine(slides, accents, seed, pat) {
  const s0 = typeof seed.__pure === 'number' ? seed.__pure : 0;
  const slideAt = flagAt(slides, s0, 1);
  const accAt = flagAt(accents, s0, 2);
  return new Pattern((state) => {
    const span = state.span;
    const lo = LOOP * Math.floor(span.begin.valueOf() / LOOP) - LOOP;
    const hi = Math.ceil(span.end.valueOf()) + LOOP + 2;
    // mono: one note per onset, in time order
    const notes = [];
    let last = null;
    for (const h of pat.queryArc(lo, hi).filter((x) => x.whole && x.hasOnset()).sort((a, b) => a.whole.begin.valueOf() - b.whole.begin.valueOf())) {
      const t = h.whole.begin.valueOf();
      if (t === last) continue;
      last = t;
      notes.push(h);
    }
    const out = [];
    let i = 0;
    while (i < notes.length) {
      const head = notes[i];
      const t0 = head.whole.begin.valueOf();
      let j = i;
      while (j + 1 < notes.length) {
        const ta = notes[j].whole.begin.valueOf();
        const tb = notes[j + 1].whole.begin.valueOf();
        if (!slideAt(ta) || tb - ta > 1 || Math.floor(tb / LOOP) !== Math.floor(t0 / LOOP)) break;
        j++;
      }
      const whole = new TimeSpan(head.whole.begin, notes[j].whole.end.max(head.whole.begin.add(1 / 256)));
      const part = whole.intersection(span);
      if (part) {
        const len = whole.end.valueOf() - t0;
        const path = notes.slice(i, j + 1).map((n) => {
          const t = n.whole.begin.valueOf();
          return `${((t - t0) / len).toFixed(5)}:${midiOf(n.value).toFixed(3)}:${accAt(t) ? 1 : 0}`;
        }).join(',');
        out.push(new Hap(whole, part, { ...head.value, acidpath: path }, head.context));
      }
      i = j + 1;
    }
    return out;
  });
}
register('acidline', acidLine, false);

// 16 sixteenths of a classic-sounding C minor line, for when nothing is patched into PITCH
const ACID_RIFF = 'c2 c3 c2 eb2 c2 g2 c2 bb1 c2 c3 c2 f2 c2 eb2 g1 c2';

export const acid = {
  type: 'acid',
  name: 'ACID',
  title: 'Acid Bass Line',
  category: 'Bonfire Only',
  strudel: false,
  hp: 16,
  description: 'The squelchy, rubbery bass of acid house: one note at a time, a saw or square through a screaming resonant filter, with real SLIDES (the pitch bends smoothly into the next note and the note never restarts) and ACCENTS (a louder note with an extra filter "yelp"). CUTOFF = where the filter rests, RES = how much it sings, ENV MOD = how far every new note opens it, DECAY = how fast it closes again. ACCENT = how hard accented notes hit, GLIDE = how long a slide takes. SLIDES and ACCENTS pick how many notes slide / get accented; the choice is fixed per step so the line repeats every bar, and SEED picks a different set. Patch a rhythm into SLIDE or ACC to choose exact steps instead (a step that is on = the note starting there slides into the next one / is accented). Twist CUTOFF, RES and ENV MOD while it plays: that is the whole genre. With nothing patched it plays a C minor line. BONFIRE ONLY: this sound does not exist on strudel.cc.',
  params: {
    wave: { kind: 'switch', label: 'WAVE', options: [{ v: 'saw', l: 'SAW' }, { v: 'square', l: 'SQUARE' }], default: 'saw' },
    cutoff: { kind: 'knob', label: 'CUTOFF', min: 40, max: 4000, default: 320, curve: 'log', unit: 'Hz' },
    res: { kind: 'knob', label: 'RES', min: 0, max: 1, default: 0.75 },
    envmod: { kind: 'knob', label: 'ENV MOD', min: 0, max: 1, default: 0.55 },
    decay: { kind: 'knob', label: 'DECAY', min: 0.03, max: 2, default: 0.3, curve: 'pow', unit: 's' },
    accent: { kind: 'knob', label: 'ACCENT', min: 0, max: 1, default: 0.6 },
    glide: { kind: 'knob', label: 'GLIDE', min: 0.01, max: 0.5, default: 0.06, curve: 'pow', unit: 's' },
    slides: { kind: 'knob', label: 'SLIDES', min: 0, max: 1, default: 0.25, size: 'sm' },
    accents: { kind: 'knob', label: 'ACCENTS', min: 0, max: 1, default: 0.25, size: 'sm' },
    seed: { kind: 'knob', label: 'SEED', min: 0, max: 15, default: 0, step: 1, size: 'sm' },
    tune: { kind: 'knob', label: 'TUNE', min: -24, max: 24, default: 0, step: 1, size: 'sm', unit: 'st' },
    level: { kind: 'knob', label: 'LEVEL', min: 0, max: 1.5, default: 1, size: 'sm' },
  },
  inputs: {
    pitch: { type: 'pitch', label: 'PITCH' },
    gate: { type: 'rhythm', label: 'GATE' },
    slide: { type: 'rhythm', label: 'SLIDE' },
    acc: { type: 'rhythm', label: 'ACC' },
    pan: { type: 'cv', label: 'PAN' },
  },
  outputs: { out: { type: 'pattern', label: 'OUT' } },
  layout: [['wave'], ['cutoff', 'res', 'envmod'], ['decay', 'accent', 'glide'], ['slides', 'accents', 'seed'], ['tune', 'level', 'in:pan'],
    ['in:pitch', 'in:gate', 'in:slide', 'in:acc', 'out:out']],
  compile(ctx) {
    const p = ctx.p;
    let e = ctx.in('pitch') ?? fn('note', mini(ACID_RIFF));
    const gate = ctx.in('gate');
    if (gate) e = e.call('struct', gate);
    e = e.callIf(p.tune, 'transpose', num(p.tune));
    e = e.call('acidline', ctx.in('slide') ?? num(p.slides, 2), ctx.in('acc') ?? num(p.accents, 2), num(p.seed, 0));
    e = e.call('s', mini('bf_acid'));
    if (p.wave === 'square') e = e.call('acidwave', num(1));
    e = e.call('acidcut', num(Math.round(p.cutoff))).call('acidres', num(p.res, 2)).call('acidenv', num(p.envmod, 2))
      .call('aciddec', num(p.decay, 3)).call('acidacc', num(p.accent, 2)).call('acidglide', num(p.glide, 3));
    e = setIf(e, 'gain', p.level, 1);
    const pan = ctx.in('pan');
    return { out: pan ? e.call('pan', pan) : e };
  },
};

// ---- MODAL: struck bars, glass, bells, metal ----
export const MODAL_MATERIALS = [{ v: 'wood', l: 'WOOD' }, { v: 'glass', l: 'GLASS' }, { v: 'bell', l: 'BELL' }, { v: 'metal', l: 'METAL' }];

export const modal = {
  type: 'modal',
  name: 'MODAL',
  title: 'Struck Resonator',
  category: 'Bonfire Only',
  strudel: false,
  hp: 14,
  description: 'Physically modelled struck objects: a mallet hits a bank of up to ten tuned resonators, each one ringing at one of the object\'s natural frequencies and fading at its own speed. MATERIAL picks the object: WOOD = marimba bar, GLASS = singing glass / bowl, BELL = church bell (its hum note sits an octave below the note you play), METAL = clangy plate, gong and industrial hits. STRIKE = soft felt mallet (low, round) or hard metal hammer (high, sharp and bright). POS = where it gets hit: near the edge (low) wakes up the high ringing, the middle (high) sounds rounder. DECAY = how long it rings while the note is held, DAMP = how much faster the high overtones die than the low ones (high = muffled, wooden; low = shimmering). STRETCH bends the overtones away from their natural spacing: small amounts make new instruments, big ones go clangy and alien. REL = how long it keeps ringing after the note ends (short = muted with a hand, long = let it ring). Feed it PITCH and/or GATE like a VOICE. BONFIRE ONLY: this sound does not exist on strudel.cc.',
  params: {
    material: { kind: 'switch', label: 'MATERIAL', options: MODAL_MATERIALS, default: 'wood' },
    strike: { kind: 'knob', label: 'STRIKE', min: 0, max: 1, default: 0.5 },
    pos: { kind: 'knob', label: 'POS', min: 0.02, max: 0.5, default: 0.2 },
    decay: { kind: 'knob', label: 'DECAY', min: 0.05, max: 12, default: 1.5, curve: 'pow', unit: 's' },
    damp: { kind: 'knob', label: 'DAMP', min: 0, max: 1, default: 0.5 },
    stretch: { kind: 'knob', label: 'STRETCH', min: -0.5, max: 0.5, default: 0 },
    tune: { kind: 'knob', label: 'TUNE', min: -24, max: 24, default: 0, step: 1, size: 'sm', unit: 'st' },
    release: { kind: 'knob', label: 'REL', min: 0.02, max: 8, default: 1, size: 'sm', curve: 'pow', unit: 's' },
    level: { kind: 'knob', label: 'LEVEL', min: 0, max: 1.5, default: 1, size: 'sm' },
  },
  inputs: VOICE_INPUTS,
  outputs: { out: { type: 'pattern', label: 'OUT' } },
  layout: [['material'], ['strike', 'pos', 'decay'], ['damp', 'stretch', 'tune'], ['release', 'level'], ['in:pitch', 'in:gate', 'in:pan', 'out:out']],
  compile(ctx) {
    const p = ctx.p;
    let e = voiceStart(ctx, 'bf_modal');
    const mat = MODAL_MATERIALS.findIndex((m) => m.v === p.material);
    if (mat > 0) e = e.call('modalmat', num(mat));
    e = e.call('modalstrike', num(p.strike, 2)).call('modalpos', num(p.pos, 2)).call('modaldecay', num(p.decay, 2))
      .call('modaldamp', num(p.damp, 2));
    e = setIf(e, 'modalstretch', p.stretch, 0, 2);
    return { out: voiceEnd(ctx, e) };
  },
};

// ---- HOOVER: supersaw / rave hoover ----
export const hoover = {
  type: 'hoover',
  name: 'HOOVER',
  title: 'Supersaw / Rave Stack',
  category: 'Bonfire Only',
  strudel: false,
  hp: 16,
  description: 'The huge rave and trance sound in one voice: seven saw waves, each slightly out of tune with the others, spread across the stereo field so they shimmer and beat against each other like a whole wall of synths. SUPER is the classic supersaw (trance leads, big chords, festival plucks). HOOVER makes every saw a slowly morphing pulse too, for the woozy, chorused "vacuum cleaner" sound of 90s hardcore and techno. DETUNE = how far apart the seven saws are (low = thick unison, high = wide and seasick). MIX = how loud the six outer saws are against the middle one. WIDTH = how far they spread left and right (0 = mono). DIP starts every note this many semitones below and swoops up to it over TIME, the hoover\'s famous "bwoow". SUB adds a plain saw an octave below for weight. Feed it PITCH and/or GATE like a VOICE; it is great with CHORDS (every chord note gets its own seven saws). Run it through a FILTER for sweeps. BONFIRE ONLY: this sound does not exist on strudel.cc.',
  params: {
    mode: { kind: 'switch', label: 'MODE', options: [{ v: 'super', l: 'SUPER' }, { v: 'hoover', l: 'HOOVER' }], default: 'super' },
    detune: { kind: 'knob', label: 'DETUNE', min: 0, max: 1, default: 0.45 },
    mix: { kind: 'knob', label: 'MIX', min: 0, max: 1, default: 0.6 },
    width: { kind: 'knob', label: 'WIDTH', min: 0, max: 1, default: 0.7 },
    dip: { kind: 'knob', label: 'DIP', min: 0, max: 12, default: 0, unit: 'st' },
    diptime: { kind: 'knob', label: 'TIME', min: 0.01, max: 1, default: 0.15, curve: 'pow', unit: 's' },
    sub: { kind: 'knob', label: 'SUB', min: 0, max: 1, default: 0 },
    tune: { kind: 'knob', label: 'TUNE', min: -24, max: 24, default: 0, step: 1, size: 'sm', unit: 'st' },
    attack: { kind: 'knob', label: 'ATK', min: 0, max: 2, default: 0.01, size: 'sm', curve: 'pow', unit: 's' },
    release: { kind: 'knob', label: 'REL', min: 0.005, max: 4, default: 0.3, size: 'sm', curve: 'pow', unit: 's' },
    level: { kind: 'knob', label: 'LEVEL', min: 0, max: 1.5, default: 1, size: 'sm' },
  },
  inputs: VOICE_INPUTS,
  outputs: { out: { type: 'pattern', label: 'OUT' } },
  layout: [['mode'], ['detune', 'mix', 'width'], ['dip', 'diptime', 'sub'], ['tune', 'attack', 'release'], ['level', 'in:pitch', 'in:gate', 'in:pan', 'out:out']],
  compile(ctx) {
    const p = ctx.p;
    let e = voiceStart(ctx, 'bf_hoover');
    if (p.mode === 'hoover') e = e.call('hoovmode', num(1));
    e = e.call('hoovdet', num(p.detune, 2)).call('hoovmix', num(p.mix, 2)).call('hoovwidth', num(p.width, 2));
    if (p.dip > 0.05) e = e.call('hoovdip', num(p.dip, 1)).call('hoovdiptime', num(p.diptime, 3));
    e = setIf(e, 'hoovsub', p.sub, 0, 2);
    return { out: voiceEnd(ctx, e) };
  },
};

// ---- DRUM: analog-style drum synthesis ----
export const DRUM_KINDS = [{ v: 'kick', l: 'KICK' }, { v: 'tom', l: 'TOM' }, { v: 'snare', l: 'SNARE' }, { v: 'clap', l: 'CLAP' }, { v: 'hat', l: 'HAT' }];
// what each model plays with nothing patched into PITCH or GATE (one bar)
const DRUM_GROOVE = { kick: 'bf_drum*4', tom: '~ ~ ~ [bf_drum bf_drum]', snare: '~ bf_drum ~ bf_drum', clap: '~ bf_drum ~ bf_drum', hat: '[~ bf_drum]*4' };

export const drum = {
  type: 'drum',
  name: 'DRUM',
  title: 'Drum Synth',
  category: 'Bonfire Only',
  strudel: false,
  hp: 12,
  description: 'Drums made from scratch, the way the classic analog drum machines did it, instead of from samples. MODEL picks the drum: KICK and TOM are a sine wave that starts high and drops to its note; SNARE adds a second skin and noisy wires; CLAP is three quick noise bursts and a short room tail; HAT is six clanging square waves and noise (short DECAY = closed hat, long = open). PUNCH = how far the pitch drops (the "thump"; on CLAP it tightens the claps, on HAT it sharpens the hit). DECAY = how long it rings, centred on each model\'s classic length. TONE = darker or brighter (a rounder, harder body; brighter noise). NOISE adds more noise (snare wires, a breathy kick). CLICK = the beater hitting the skin. DRIVE saturates it. Patch PITCH and the kick/tom/snare play that note in their own octave, so the kick is always in key with the song (a C4 melody note still gives a low C kick); TUNE fine-tunes it. Patch a rhythm into GATE to choose when it hits; with nothing patched it plays a basic groove for its model. BONFIRE ONLY: this sound does not exist on strudel.cc.',
  params: {
    model: { kind: 'rotary', label: 'MODEL', options: DRUM_KINDS, default: 'kick' },
    punch: { kind: 'knob', label: 'PUNCH', min: 0, max: 1, default: 0.5 },
    decay: { kind: 'knob', label: 'DECAY', min: 0, max: 1, default: 0.5 },
    tone: { kind: 'knob', label: 'TONE', min: 0, max: 1, default: 0.3 },
    noise: { kind: 'knob', label: 'NOISE', min: 0, max: 1, default: 0 },
    click: { kind: 'knob', label: 'CLICK', min: 0, max: 1, default: 0.3 },
    tune: { kind: 'knob', label: 'TUNE', min: -24, max: 24, default: 0, step: 1, size: 'sm', unit: 'st' },
    drive: { kind: 'knob', label: 'DRIVE', min: 0, max: 1, default: 0.2, size: 'sm' },
    level: { kind: 'knob', label: 'LEVEL', min: 0, max: 1.5, default: 1, size: 'sm' },
  },
  inputs: VOICE_INPUTS,
  outputs: { out: { type: 'pattern', label: 'OUT' } },
  layout: [['model', 'punch', 'decay'], ['tone', 'noise', 'click'], ['tune', 'drive', 'level'], ['in:pitch', 'in:gate', 'in:pan', 'out:out']],
  compile(ctx) {
    const p = ctx.p;
    const pitch = ctx.in('pitch');
    const gate = ctx.in('gate');
    let e;
    if (pitch) e = pitch.call('s', mini('bf_drum')).call('drumkey', num(1));
    else e = fn('s', mini(gate ? 'bf_drum' : DRUM_GROOVE[p.model] ?? DRUM_GROOVE.kick));
    if (gate) e = e.call('struct', gate);
    const model = Math.max(0, DRUM_KINDS.findIndex((k) => k.v === p.model));
    if (model) e = e.call('drummodel', num(model));
    e = setIf(e, 'drumtune', p.tune, 0, 0);
    e = e.call('drumpunch', num(p.punch, 2)).call('drumdecay', num(p.decay, 2)).call('drumtone', num(p.tone, 2));
    e = setIf(e, 'drumnoise', p.noise, 0, 2);
    e = e.call('drumclick', num(p.click, 2)).call('drumdrive', num(p.drive, 2));
    e = setIf(e, 'gain', p.level, 1);
    const pan = ctx.in('pan');
    return { out: pan ? e.call('pan', pan) : e };
  },
};

// ---- GRAIN: granular cloud ----
export const grain = {
  type: 'grain',
  name: 'GRAIN',
  title: 'Granular Cloud',
  category: 'Bonfire Only',
  strudel: false,
  hp: 16,
  description: 'Granular synthesis: chops a sample into dozens of tiny, softly faded slices ("grains") every second and plays them overlapping, so any sound (a piano note, a voice, a drum hit) smears into pads, shimmering clouds and strange textures. POS = where in the sample the grains come from (start to end; a long fading sample like a piano note is trimmed to the part you can hear, so the end of POS is its quiet tail). SPRAY scatters them around POS. SCAN moves POS through the sample while the note plays (0 = frozen in place, 1 = at normal speed, below 0 = backwards). SIZE = how long each grain is (short = buzzy, glitchy; long = smooth and recognisable). DENSITY = grains per second. SHIMMER detunes the grains and sends some of them an octave up, for that heavenly sparkle. WIDTH spreads them across the stereo field. Patch an LFO or KHAOZ into POS to make the cloud wander. Feed it PITCH (notes play the sample at that pitch, like a sample VOICE) and/or GATE; with nothing patched it plays one long note per bar. Pick the SAMPLE by clicking its display or dropping one from the SAMPLES tab (samples and GM instruments work; the plain synth waves and noises in the synth tab have no recording to chop, so they stay silent). The very first note of a new sample can be silent while it loads. BONFIRE ONLY: this sound does not exist on strudel.cc.',
  params: {
    sound: { kind: 'sound', label: 'SAMPLE', default: 'piano', structural: true, recorded: true },
    n: { kind: 'knob', label: 'VARIANT', min: 0, max: 15, default: 0, step: 1, size: 'sm' },
    pos: { kind: 'knob', label: 'POS', min: 0, max: 1, default: 0.1 },
    spray: { kind: 'knob', label: 'SPRAY', min: 0, max: 1, default: 0.1 },
    scan: { kind: 'knob', label: 'SCAN', min: -1, max: 1, default: 0 },
    size: { kind: 'knob', label: 'SIZE', min: 0.01, max: 0.5, default: 0.12, curve: 'pow', unit: 's' },
    density: { kind: 'knob', label: 'DENSITY', min: 1, max: 80, default: 18, curve: 'pow' },
    shimmer: { kind: 'knob', label: 'SHIMMER', min: 0, max: 1, default: 0 },
    width: { kind: 'knob', label: 'WIDTH', min: 0, max: 1, default: 0.6, size: 'sm' },
    tune: { kind: 'knob', label: 'TUNE', min: -24, max: 24, default: 0, step: 1, size: 'sm', unit: 'st' },
    attack: { kind: 'knob', label: 'ATK', min: 0, max: 4, default: 0.3, size: 'sm', curve: 'pow', unit: 's' },
    release: { kind: 'knob', label: 'REL', min: 0.02, max: 8, default: 1.5, size: 'sm', curve: 'pow', unit: 's' },
    level: { kind: 'knob', label: 'LEVEL', min: 0, max: 1.5, default: 1, size: 'sm' },
  },
  inputs: { ...VOICE_INPUTS, pos: { type: 'cv', label: 'POS' } },
  outputs: { out: { type: 'pattern', label: 'OUT' } },
  layout: [['sound', 'n'], ['pos', 'spray', 'scan'], ['size', 'density', 'shimmer'], ['width', 'tune', 'attack', 'release'],
    ['level', 'in:pos', 'in:pitch', 'in:gate', 'in:pan', 'out:out']],
  compile(ctx) {
    const p = ctx.p;
    const pitch = ctx.in('pitch');
    const gate = ctx.in('gate');
    let e = pitch ? pitch.call('s', mini('bf_grain')) : fn('s', mini('bf_grain'));
    if (gate) e = e.call('struct', gate);
    e = e.call('grainsrc', mini(p.sound));
    e = setIf(e, 'grainn', p.n, 0, 0);
    e = setIf(e, 'graintune', p.tune, 0, 0);
    const pos = ctx.in('pos');
    e = e.call('grainpos', pos ?? num(p.pos, 3)).call('grainspray', num(p.spray, 2));
    e = setIf(e, 'grainscan', p.scan, 0, 2);
    e = e.call('grainsize', num(p.size, 3)).call('graindens', num(p.density, 1));
    e = setIf(e, 'grainshim', p.shimmer, 0, 2);
    e = e.call('grainwidth', num(p.width, 2));
    return { out: voiceEnd(ctx, e) };
  },
};

// ---- FM4: 4-operator FM voice ----
// Operator 1 is always a carrier; a modulator always has a higher number than what it modulates, so
// the worklet can run 4 -> 1 in one pass. mods[i] = operators feeding operator i; FEEDBACK is on 4.
export const FM_ALGOS = [
  { l: 'STACK', mods: [[1], [2], [3], []], car: [0] }, // 4>3>2>1
  { l: 'TWO PAIRS', mods: [[1], [], [3], []], car: [0, 2] }, // 2>1, 4>3
  { l: '3 INTO 1', mods: [[1, 2, 3], [], [], []], car: [0] }, // 2,3,4>1
  { l: 'BRANCH', mods: [[2], [2], [3], []], car: [0, 1] }, // 4>3>(1,2)
  { l: 'STACK + 1', mods: [[], [2], [3], []], car: [0, 1] }, // 4>3>2, 1
  { l: '1 INTO 3', mods: [[3], [3], [3], []], car: [0, 1, 2] }, // 4>(1,2,3)
  { l: 'PAIR + 2', mods: [[1], [], [], []], car: [0, 2, 3] }, // 2>1, 3, 4
  { l: 'ORGAN', mods: [[], [], [], []], car: [0, 1, 2, 3] }, // all carriers
];
export const FM_RATIOS = [0.5, 1, 1.41, 2, 2.76, 3, 3.5, 4, 5, 5.4, 6, 7, 8, 9, 10, 11, 12, 14];
const OPS = [0, 1, 2, 3];
// one preset = algo, feedback, sustain, hold, chorus + per operator [ratio, level, attack, decay]
const fmp = (v, l, algo, fb, ops, { sus = 0.7, hold = false, chorus = false } = {}) => ({ v, l, algo, fb, sus, hold, chorus, ops });
export const FM_PRESETS = [
  fmp('epiano', 'E.PIANO', 1, 0, [[1, 0.9, 0, 3], [1, 0.4, 0, 1.2], [1, 0.45, 0, 2], [14, 0.22, 0, 0.25]], { chorus: true }),
  fmp('tine', 'TINE EP', 1, 0, [[1, 0.9, 0, 2.5], [1, 0.6, 0, 0.9], [1, 0.45, 0, 1.6], [14, 0.45, 0, 0.3]], { chorus: true }),
  fmp('bell', 'BELL', 1, 0, [[1, 0.8, 0, 6], [3.5, 0.45, 0, 4], [2, 0.4, 0, 5], [5.4, 0.35, 0, 2.5]]),
  fmp('tubular', 'TUBULAR', 1, 0, [[1, 0.8, 0, 8], [3.5, 0.55, 0, 6], [1, 0.4, 0, 7], [1.41, 0.4, 0, 4]]),
  fmp('glass', 'GLASS', 4, 0, [[1, 0.55, 0, 4], [4, 0.45, 0, 3], [7, 0.3, 0, 2], [1, 0.2, 0, 1]]),
  fmp('fmbass', 'FM BASS', 0, 0.55, [[0.5, 0.95, 0, 1.5], [1, 0.6, 0, 0.4], [1, 0.4, 0, 0.2], [1, 0.3, 0, 0.15]]),
  fmp('slap', 'SLAP BASS', 2, 0, [[1, 0.9, 0, 1], [1, 0.5, 0, 0.3], [3, 0.35, 0, 0.08], [5, 0.3, 0, 0.04]]),
  fmp('brass', 'BRASS', 0, 0.4, [[1, 0.9, 0.05, 3], [1, 0.6, 0.08, 1], [1, 0.3, 0.05, 1], [1, 0.3, 0.02, 0.5]], { hold: true, sus: 0.8 }),
  fmp('organ', 'ORGAN', 7, 0, [[1, 0.7, 0.005, 1], [2, 0.5, 0.005, 1], [3, 0.4, 0.005, 1], [4, 0.3, 0.005, 1]], { hold: true, sus: 1 }),
  fmp('marimba', 'MARIMBA', 1, 0, [[1, 0.9, 0, 0.6], [4, 0.3, 0, 0.05], [4, 0.15, 0, 0.2], [10, 0.2, 0, 0.02]]),
  fmp('clav', 'CLAV', 2, 0.3, [[1, 0.9, 0, 0.8], [3, 0.55, 0, 0.4], [1, 0.3, 0, 0.3], [5, 0.2, 0, 0.1]]),
  fmp('metal', 'METAL HIT', 5, 0.7, [[1, 0.6, 0, 1.5], [1.41, 0.6, 0, 1.2], [2.76, 0.6, 0, 1], [3.5, 0.8, 0, 0.6]]),
  fmp('space', 'SPACE PAD', 1, 0, [[1, 0.7, 1, 2], [2, 0.35, 1.5, 3], [1, 0.5, 1.2, 2], [3, 0.25, 2, 3]], { hold: true, sus: 0.7, chorus: true }),
];
// a preset as the params it sets (what the presets list and DICE write)
export function fmPresetParams(pr) {
  const out = { preset: pr.v, algo: pr.algo, fb: pr.fb, sus: pr.sus, hold: pr.hold, chorus: pr.chorus };
  pr.ops.forEach(([r, l, a, d], i) => Object.assign(out, { [`ratio${i}`]: r, [`level${i}`]: l, [`atk${i}`]: a, [`dec${i}`]: d }));
  return out;
}
const FM_DEFAULT = fmPresetParams(FM_PRESETS[0]);

export const fm4 = {
  type: 'fm4',
  name: 'FM4',
  title: '4-Operator FM Voice',
  category: 'Bonfire Only',
  strudel: false,
  hp: 24,
  description: 'FM synthesis, the sound of the 80s: electric pianos, bells, glassy keys, slap and synth basses, brass, organs and clangy metal. Four sine waves ("operators") bend each other\'s pitch thousands of times a second, which makes rich, bright, often bell-like tones. Two faces. BASIC: pick a PRESET (or roll DICE for a random new sound), then shape it with four knobs: BRIGHT = how hard the operators push each other (dull to biting), TIME = how long it rings, METAL = pulls the tuning away from whole numbers (musical to clangy), SOFTEN = a slower attack (a stab becomes a pad). ADVANCED shows what the preset really is: ALGO picks how the four operators are wired (the diagram flows left to right: the filled boxes are the ones you hear, an outlined box shapes the tone of the box its line runs into), FEEDBACK makes operator 4 modulate itself (rougher, saw-like), and every operator has a RATIO (its pitch compared to the note), a LEVEL, an ATK and a DEC. The BASIC knobs stay on top of the ADVANCED settings, so you can switch back and forth. HOLD makes notes sustain while held (at SUS, for pads, organ, brass) instead of dying away like a struck key. CHORUS adds the classic stereo shimmer. ACC: accented steps play brighter, the way a harder key press does. BRIGHT CV: patch an LFO for a "wah" sweep. Feed it PITCH and/or GATE like a VOICE. BONFIRE ONLY: this sound does not exist on strudel.cc.',
  params: {
    face: { kind: 'switch', label: 'FACE', options: [{ v: 'basic', l: 'BASIC' }, { v: 'advanced', l: 'ADVANCED' }], default: 'basic' },
    preset: { kind: 'data', default: FM_DEFAULT.preset },
    algo: { kind: 'data', default: FM_DEFAULT.algo },
    bright: { kind: 'knob', label: 'BRIGHT', min: 0, max: 1, default: 0.5 },
    time: { kind: 'knob', label: 'TIME', min: 0, max: 1, default: 0.5 },
    metal: { kind: 'knob', label: 'METAL', min: 0, max: 1, default: 0 },
    soften: { kind: 'knob', label: 'SOFTEN', min: 0, max: 1, default: 0 },
    fb: { kind: 'knob', label: 'FEEDBACK', min: 0, max: 1, default: FM_DEFAULT.fb, size: 'sm' },
    sus: { kind: 'knob', label: 'SUS', min: 0, max: 1, default: FM_DEFAULT.sus, size: 'sm' },
    ...Object.fromEntries(OPS.flatMap((i) => [
      [`ratio${i}`, { kind: 'rotary', label: `OP ${i + 1}`, options: FM_RATIOS.map((r) => ({ v: r, l: `×${r}` })), default: FM_DEFAULT[`ratio${i}`], size: 'sm' }],
      [`level${i}`, { kind: 'knob', label: 'LEVEL', min: 0, max: 1, default: FM_DEFAULT[`level${i}`], size: 'sm' }],
      [`atk${i}`, { kind: 'knob', label: 'ATK', min: 0, max: 3, default: FM_DEFAULT[`atk${i}`], curve: 'pow', size: 'sm', unit: 's' }],
      [`dec${i}`, { kind: 'knob', label: 'DEC', min: 0.02, max: 10, default: FM_DEFAULT[`dec${i}`], curve: 'pow', size: 'sm', unit: 's' }],
    ])),
    hold: { kind: 'toggle', label: 'HOLD', default: FM_DEFAULT.hold },
    chorus: { kind: 'toggle', label: 'CHORUS', default: FM_DEFAULT.chorus },
    tune: { kind: 'knob', label: 'TUNE', min: -24, max: 24, default: 0, step: 1, size: 'sm', unit: 'st' },
    release: { kind: 'knob', label: 'REL', min: 0.02, max: 6, default: 0.4, size: 'sm', curve: 'pow', unit: 's' },
    level: { kind: 'knob', label: 'LEVEL', min: 0, max: 1.5, default: 1, size: 'sm' },
  },
  inputs: { ...VOICE_INPUTS, acc: { type: 'rhythm', label: 'ACC' }, bright: { type: 'cv', label: 'BRIGHT' } },
  outputs: { out: { type: 'pattern', label: 'OUT' } },
  layout: [['face'], ['widget:fmPresets'], ['bright', 'time', 'metal', 'soften'], ['widget:fmAlgo', 'fb', 'sus'],
    ...[[0, 1], [2, 3]].map((pair) => pair.flatMap((i) => [`ratio${i}`, `level${i}`, `atk${i}`, `dec${i}`])),
    ['hold', 'chorus', 'tune', 'release', 'level'], ['in:pitch', 'in:gate', 'in:acc', 'in:bright', 'in:pan', 'out:out']],
  compile(ctx) {
    const p = ctx.p;
    let e = voiceStart(ctx, 'bf_fm');
    const acc = ctx.in('acc');
    if (acc) e = e.call('fmacc', acc);
    e = setIf(e, 'fmalgo', p.algo, 0, 0);
    e = setIf(e, 'fmfb', p.fb, 0, 2);
    for (const i of OPS) {
      e = e.call(`fmr${i}`, num(p[`ratio${i}`], 2)).call(`fml${i}`, num(p[`level${i}`], 2));
      e = setIf(e, `fma${i}`, p[`atk${i}`], 0, 3);
      e = e.call(`fmd${i}`, num(p[`dec${i}`], 2));
    }
    if (p.hold) e = e.call('fmhold', num(1)).call('fmsus', num(p.sus, 2));
    if (p.chorus) e = e.call('fmchorus', num(1));
    const bright = ctx.in('bright');
    e = bright ? e.call('fmbright', bright) : setIf(e, 'fmbright', p.bright, 0.5, 2);
    e = setIf(e, 'fmtime', p.time, 0.5, 2);
    e = setIf(e, 'fmmetal', p.metal, 0, 2);
    e = setIf(e, 'fmsoft', p.soften, 0, 2);
    return { out: voiceEnd(ctx, e) };
  },
};

// ---- BUS EFFECTS (FRIDGE, HALO, STUTTER, MIRAGE): modules that hear the live sound, not just the notes ----
// The notes pass straight through; .bfsend(id, kind) only tags them so the engine also sends their
// sound into this module's worklet (core/forge-audio.js). What the worklet makes comes back as a
// held s("bus") note stacked next to them, so everything patched after the module treats it like
// any other sound. bfpg remembers the postgain a note had coming in (see busFxEvents: the effect
// hears the note before a later MIXER level, which then turns its output up and down like the notes);
// bfroom / bfdelay the reverb and delay it already had (an insert keeps those and drops later ones).
const plain = (x) => String(x?.firstCycle ? x.firstCycle()[0]?.value : x); // Strudel wraps arguments in patterns
register('bfsend', (id, kind, pat) => {
  const tag = `${plain(kind)}:${plain(id)}`;
  return pat.withValue((v) => (typeof v !== 'object' || v === null ? v : {
    ...v,
    bfin: v.bfin ? `${v.bfin},${tag}` : tag,
    bfpg: v.bfpg ?? v.postgain ?? 1,
    bfroom: v.bfroom ?? v.room ?? 0,
    bfdelay: v.bfdelay ?? v.delay ?? 0,
  }));
}, false);

// [the tagged notes, the held note that plays the module's output]
function busFxParts(ctx, e, kind, fade = 0.03) {
  // one held note per bar; equal linear fades in and out, so the joins between bars add up flat
  const wet = fn('s', mini('bus')).call('n', mini(`bfout_${ctx.id}`)).call('gain', num(1))
    .call('attack', num(fade, 2)).call('release', num(fade, 2))
    .call('bfout', mini(ctx.id)).call('bfkind', mini(kind));
  return [e.call('bfsend', str(ctx.id), str(kind)), wet];
}

// ---- FRIDGE: a freeze pedal ----
// The FREEZE button is a live gesture (like a footswitch): it is not part of the patch or the code.
export const fridge = {
  type: 'fridge',
  name: 'FRIDGE',
  title: 'Freeze Pedal',
  category: 'Bonfire Only',
  strudel: false,
  hp: 8,
  description: 'A freeze pedal. Press FREEZE and it records the next LENGTH seconds of whatever is coming in, then keeps playing that slice while your notes carry on over the top. Press FREEZE again to let it go. MODE: LOOP plays the slice round and round (short lengths buzz and stutter, longer ones turn into a little loop); SMOOTH blurs it into a steady pad with no audible repeat. LEVEL is how loud the frozen sound is. TRIG presses the button for you: every step that is on freezes afresh, right on that step, and the old freeze keeps sounding until the new one is ready (pressing FREEZE lets go until the next step). Whatever you patch after FRIDGE (FILTER, FX, TAPE, a MIXER channel) works on the frozen sound too. The FREEZE button is something you play live: it is not saved in the patch, and it needs the patch to be playing.',
  params: {
    mode: { kind: 'switch', label: 'MODE', options: [{ v: 'loop', l: 'LOOP' }, { v: 'smooth', l: 'SMOOTH' }], default: 'loop' },
    length: { kind: 'knob', label: 'LENGTH', min: 0.1, max: 1, default: 0.5, unit: 's' },
    level: { kind: 'knob', label: 'LEVEL', min: 0, max: 1.5, default: 1 },
  },
  inputs: { in: { type: 'pattern', label: 'IN' }, trig: { type: 'rhythm', label: 'TRIG' } },
  outputs: { out: { type: 'pattern', label: 'OUT' } },
  actions: { freeze: { label: 'FREEZE', led: true } },
  layout: [['widget:fridgeDoor'], ['freeze'], ['mode'], ['length', 'level'], ['in:in', 'in:trig', 'out:out']],
  compile(ctx) {
    const e = ctx.in('in');
    if (!e) return { out: null };
    const p = ctx.p;
    const [notes, wet] = busFxParts(ctx, e, 'fridge');
    const parts = [notes, wet.call('fridgelvl', num(p.level, 2)).call('fridgesmooth', num(p.mode === 'smooth' ? 1 : 0))];
    // TRIG: soundless events the engine turns into button presses at their exact time
    const trig = ctx.in('trig');
    if (trig) parts.push(fn('n', num(0)).call('struct', trig).call('fridgetrig', mini(ctx.id)).call('fridgelen', num(p.length, 2)));
    return { out: fn('stack', ...parts) };
  },
};

// ---- HALO: shimmer reverb ----
const HALO_PITCH = [{ v: 12, l: '+OCT' }, { v: 7, l: '+5TH' }, { v: 19, l: '+OCT5' }, { v: -12, l: '-OCT' }];

export const halo = {
  type: 'halo',
  name: 'HALO',
  title: 'Shimmer Reverb',
  category: 'Bonfire Only',
  strudel: false,
  hp: 10,
  description: 'A shimmer reverb: a big, slow reverb whose tail keeps being fed back into itself an octave higher, so a chord blooms into a glowing, choir-like halo above the notes. SHIMMER is how much of the tail climbs (0 = a plain lush reverb). PITCH picks the climb: an octave up, a fifth, an octave and a fifth, or an octave down for a dark, sinking tail. DECAY is how long it rings, SIZE the size of the space, TONE how bright the tail stays, LEVEL how loud the reverb is next to your notes. Your notes pass through untouched; whatever you patch after HALO (FILTER, TAPE, a MIXER channel) works on the reverb too. The tail only sounds while the patch is playing.',
  params: {
    shimmer: { kind: 'knob', label: 'SHIMMER', min: 0, max: 1, default: 0.5, size: 'lg' },
    decay: { kind: 'knob', label: 'DECAY', min: 0.5, max: 20, default: 6, curve: 'log', unit: 's' },
    size: { kind: 'knob', label: 'SIZE', min: 0, max: 1, default: 0.6 },
    tone: { kind: 'knob', label: 'TONE', min: 1000, max: 16000, default: 6000, curve: 'log', unit: 'Hz', size: 'sm' },
    pitch: { kind: 'rotary', label: 'PITCH', options: HALO_PITCH, default: 12, size: 'sm' },
    level: { kind: 'knob', label: 'LEVEL', min: 0, max: 1.5, default: 0.7, size: 'sm' },
  },
  inputs: { in: { type: 'pattern', label: 'IN' } },
  outputs: { out: { type: 'pattern', label: 'OUT' } },
  layout: [['shimmer'], ['decay', 'size'], ['tone', 'pitch', 'level'], ['in:in', 'out:out']],
  compile(ctx) {
    const e = ctx.in('in');
    if (!e) return { out: null };
    const p = ctx.p;
    if (p.level < 0.005) return { out: e };
    const [notes, wet] = busFxParts(ctx, e, 'halo');
    return { out: fn('stack', notes, wet.call('haloshim', num(p.shimmer, 2)).call('halodecay', num(p.decay, 2)).call('halosize', num(p.size, 2))
      .call('halotone', num(Math.round(p.tone))).call('halopitch', num(p.pitch)).call('halolvl', num(p.level, 2))) };
  },
};

// ---- STUTTER: beat repeat ----
// An insert (see core/forge-audio.js): the notes' sound only reaches the output through STUTTER's
// worklet, which passes it on untouched until the button / a TRIG step makes it repeat a slice.
// The button is a live gesture; TRIG steps are part of the patch.
export const STUTTER_RATES = [
  { v: 1 / 4, l: '1/4' }, { v: 1 / 8, l: '1/8' }, { v: 1 / 12, l: '1/8T' }, { v: 1 / 16, l: '1/16' },
  { v: 1 / 24, l: '1/16T' }, { v: 1 / 32, l: '1/32' }, { v: 1 / 64, l: '1/64' },
];
const STUTTER_SPANS = [{ v: 0.25, l: '1/4 BAR' }, { v: 0.5, l: '1/2 BAR' }, { v: 1, l: '1 BAR' }, { v: 2, l: '2 BAR' }, { v: 0, l: 'HOLD' }];

export const stutter = {
  type: 'stutter',
  name: 'STUTTER',
  title: 'Beat Repeat',
  category: 'Bonfire Only',
  strudel: false,
  hp: 8,
  description: 'The glitch button: grabs a tiny slice of what is playing through it and machine-guns it in time, with the live sound cut off until it lets go. Press STUTTER and it starts on the next beat line: the first slice plays as normal, then repeats. RATE is the slice length (1/16 = sixteenth notes; 1/32 and 1/64 turn into a buzz; T = triplets). FOR is how long it keeps going before it lets go by itself; HOLD keeps going until you press again. FADE makes every repeat quieter than the one before. TRIG presses the button for you: every step that is on starts a stutter right on that step, which makes it part of the song (fills at the end of a bar). Patch it after the sound (or a whole MIXER) you want to stutter. The button is something you play live: it is not saved in the patch.',
  params: {
    rate: { kind: 'rotary', label: 'RATE', options: STUTTER_RATES, default: 1 / 16 },
    span: { kind: 'rotary', label: 'FOR', options: STUTTER_SPANS, default: 0.5 },
    fade: { kind: 'knob', label: 'FADE', min: 0, max: 1, default: 0, size: 'sm' },
  },
  inputs: { in: { type: 'pattern', label: 'IN' }, trig: { type: 'rhythm', label: 'TRIG' } },
  outputs: { out: { type: 'pattern', label: 'OUT' } },
  actions: { stutter: { label: 'STUTTER', led: true } },
  layout: [['widget:stutterLamp'], ['stutter'], ['rate', 'span'], ['fade'], ['in:in', 'in:trig', 'out:out']],
  compile(ctx) {
    const e = ctx.in('in');
    if (!e) return { out: null };
    const p = ctx.p;
    const secs = (cycles) => num((cycles * 240) / ctx.global.bpm, 4);
    const [notes, wet] = busFxParts(ctx, e, 'stutter', 0.01);
    const parts = [notes, wet.call('stutfade', num(p.fade, 2))];
    const trig = ctx.in('trig');
    if (trig) parts.push(fn('n', num(0)).call('struct', trig).call('stuttrig', mini(ctx.id)).call('stutlen', secs(p.rate)).call('stutdur', secs(p.span)));
    return { out: fn('stack', ...parts) };
  },
};

// ---- MIRAGE: chorus / ensemble / flanger ----
const MIRAGE_MODES = [{ v: 'chorus', l: 'CHORUS' }, { v: 'ensemble', l: 'ENSEMBLE' }, { v: 'flange', l: 'FLANGE' }];

export const mirage = {
  type: 'mirage',
  name: 'MIRAGE',
  title: 'Chorus / Ensemble',
  category: 'Bonfire Only',
  strudel: false,
  hp: 10,
  description: 'A chorus pedal: adds slightly delayed copies of the sound whose timing keeps drifting, so one note sounds like several players, wider and thicker, with a slow watery wobble. MODE: CHORUS is the classic pedal (clean guitar, post-punk bass, 80s synths); ENSEMBLE stacks three copies for the lush string-machine sound; FLANGE is the jet-plane sweep. RATE is how fast it wobbles, DEPTH how far (low = gentle thickening, high = seasick), WIDTH how far apart left and right drift (0 = mono), LEVEL how loud the copies are next to your notes. Your notes pass through untouched; whatever you patch after MIRAGE works on its sound too.',
  params: {
    mode: { kind: 'rotary', label: 'MODE', options: MIRAGE_MODES, default: 'chorus' },
    rate: { kind: 'knob', label: 'RATE', min: 0.05, max: 8, default: 0.6, curve: 'log', unit: 'Hz' },
    depth: { kind: 'knob', label: 'DEPTH', min: 0, max: 1, default: 0.5 },
    width: { kind: 'knob', label: 'WIDTH', min: 0, max: 1, default: 1, size: 'sm' },
    level: { kind: 'knob', label: 'LEVEL', min: 0, max: 1.5, default: 1, size: 'sm' },
  },
  inputs: { in: { type: 'pattern', label: 'IN' } },
  outputs: { out: { type: 'pattern', label: 'OUT' } },
  layout: [['mode'], ['rate', 'depth'], ['width', 'level'], ['in:in', 'out:out']],
  compile(ctx) {
    const e = ctx.in('in');
    if (!e) return { out: null };
    const p = ctx.p;
    if (p.level < 0.005) return { out: e };
    const [notes, wet] = busFxParts(ctx, e, 'mirage');
    return { out: fn('stack', notes, wet.call('mirmode', num(Math.max(0, MIRAGE_MODES.findIndex((m) => m.v === p.mode))))
      .call('mirrate', num(p.rate, 2)).call('mirdepth', num(p.depth, 2)).call('mirwidth', num(p.width, 2)).call('mirlvl', num(p.level, 2))) };
  },
};
