// BONFIRE ONLY modules: their sound comes from Bonfire's own DSP (core/forge-audio.js), not from
// anything strudel.cc ships, so the generated code only plays inside Bonfire. They still take and
// give normal Strudel patterns, so MELODY/CHAIN/GATE in and FILTER/FX/MIXER out all work as usual.
// Every definition here sets `strudel: false`; the drawer, faceplate and compiler key off that.
import { Pattern, Hap, TimeSpan, noteToMidi, register, registerControl } from '@strudel/core';
import { fn, mini, num } from '../core/expr.js';
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
