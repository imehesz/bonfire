// Shared musical vocab: sound catalogues, banks, scales, note naming.

const NOTE_NAMES = ['c', 'db', 'd', 'eb', 'e', 'f', 'gb', 'g', 'ab', 'a', 'bb', 'b'];
export const ROOTS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

// Strudel: c3 = MIDI 48.
export function midiToNote(m) {
  const r = Math.round(m);
  return NOTE_NAMES[((r % 12) + 12) % 12] + (Math.floor(r / 12) - 1);
}

export const SCALES = [
  ['major', 'MAJOR'],
  ['minor', 'MINOR'],
  ['dorian', 'DORIAN'],
  ['phrygian', 'PHRYGIAN'],
  ['lydian', 'LYDIAN'],
  ['mixolydian', 'MIXOLYD'],
  ['harmonic minor', 'HARM MIN'],
  ['minor:pentatonic', 'MIN PENTA'],
  ['major:pentatonic', 'MAJ PENTA'],
  ['blues', 'BLUES'],
  ['chromatic', 'CHROMA'],
];

export const WAVES = [
  ['sine', 'SIN'],
  ['triangle', 'TRI'],
  ['sawtooth', 'SAW'],
  ['square', 'SQR'],
  ['supersaw', 'SUPER'],
  ['pulse', 'PULSE'],
];

// The tidal-drum-machines banks strudel.cc aliases (alias -> short name shown).
export const BANKS = [
  '', 'RolandTR808', 'RolandTR909', 'RolandTR707', 'RolandTR606', 'RolandTR505', 'RolandTR626',
  'RolandTR727', 'RolandCompurhythm78', 'RolandCompurhythm1000', 'RolandCompurhythm8000', 'RolandR8',
  'RolandMC303', 'RolandMC202', 'RolandD110', 'RolandD70', 'RolandDDR30', 'RolandJD990', 'RolandMT32',
  'RolandS50', 'RolandSH09', 'RolandSystem100', 'LinnLM1', 'LinnLM2', 'Linn9000', 'AkaiLinn', 'AkaiMPC60',
  'AkaiXR10', 'AlesisHR16', 'AlesisSR16', 'BossDR110', 'BossDR220', 'BossDR55', 'BossDR550', 'CasioRZ1',
  'CasioSK1', 'CasioVL1', 'DoepferMS404', 'EmuDrumulator', 'EmuSP12', 'KorgDDM110', 'KorgKPR77',
  'KorgKR55', 'KorgKRZ', 'KorgM1', 'KorgMinipops', 'KorgPoly800', 'KorgT3', 'MoogConcertMateMG1',
  'OberheimDMX', 'RhodesPolaris', 'RhythmAce', 'SakataDPM48', 'SequentialCircuitsDrumtracks',
  'SequentialCircuitsTom', 'SimmonsSDS400', 'SimmonsSDS5', 'SoundmastersR88', 'UnivoxMicroRhythmer12',
  'ViscoSpaceDrum', 'XdrumLM8953', 'YamahaRM50', 'YamahaRX21', 'YamahaRX5', 'YamahaRY30', 'YamahaTG33',
  'AJKPercusyn',
];
export const bankLabel = (b) => (b ? b.replace(/^(Roland|Korg|Yamaha|Boss|Akai|Linn|Alesis|Casio|Emu|Simmons|SequentialCircuits)/, '') || b : 'DEFAULT');

export const DRUM_SOUNDS = ['bd', 'sd', 'hh', 'oh', 'cp', 'rim', 'lt', 'mt', 'ht', 'cr', 'rd', 'cb', 'sh', 'tb', 'misc', 'brk'];

// Categories the sound picker shows. Every name here exists in the
// strudel.cc default prebake, so exported code plays there unchanged.
export const SOUND_CATEGORIES = {
  drums: DRUM_SOUNDS,
  percussion: ['bongo', 'conga', 'cajon', 'clave', 'cowbell', 'guiro', 'shaker_small', 'shaker_large', 'tambourine',
    'woodblock', 'agogo', 'darbuka', 'framedrum', 'cabasa', 'triangles', 'sleighbells', 'jazz'],
  industrial: ['metal', 'anvil', 'brakedrum', 'ratchet', 'slapstick', 'flexatone', 'vibraslap', 'casio', 'gong',
    'oceandrum', 'insect', 'wind', 'space', 'crow', 'numbers', 'east'],
  bass: ['gm_acoustic_bass', 'gm_electric_bass_finger', 'gm_electric_bass_pick', 'gm_fretless_bass', 'gm_slap_bass_1',
    'gm_synth_bass_1', 'gm_synth_bass_2', 'gm_contrabass', 'gm_lead_8_bass_lead'],
  keys: ['piano', 'steinway', 'kawai', 'gm_epiano1', 'gm_epiano2', 'gm_harpsichord', 'gm_clavinet', 'gm_drawbar_organ',
    'gm_church_organ', 'gm_accordion', 'clavisynth', 'fmpiano'],
  mallets: ['kalimba', 'marimba', 'vibraphone', 'glockenspiel', 'xylophone_medium_ff', 'gm_music_box', 'gm_celesta',
    'tubularbells', 'handbells', 'gm_steel_drums', 'wineglass', 'balafon'],
  strings: ['gm_string_ensemble_1', 'gm_synth_strings_1', 'gm_tremolo_strings', 'gm_pizzicato_strings', 'gm_violin',
    'gm_cello', 'harp', 'folkharp', 'gm_acoustic_guitar_nylon', 'gm_electric_guitar_clean', 'gm_distortion_guitar', 'gm_koto', 'gm_sitar'],
  pads: ['gm_pad_warm', 'gm_pad_halo', 'gm_pad_sweep', 'gm_pad_new_age', 'gm_pad_choir', 'gm_choir_aahs',
    'gm_voice_oohs', 'gm_fx_atmosphere', 'gm_fx_crystal', 'gm_fx_echoes', 'gm_fx_rain'],
  winds: ['gm_flute', 'sax', 'gm_alto_sax', 'recorder_alto_sus', 'ocarina', 'harmonica', 'gm_trumpet', 'gm_french_horn',
    'gm_brass_section', 'gm_pan_flute', 'didgeridoo', 'pipeorgan_loud'],
  synth: ['sine', 'triangle', 'sawtooth', 'square', 'supersaw', 'pulse', 'white', 'pink', 'brown', 'crackle',
    'gm_lead_1_square', 'gm_lead_2_sawtooth', 'gm_synth_brass_1'],
};

// Sounds whose pitch follows note() — everything except one-shot drum hits.
export function isPitched(sound) {
  return !SOUND_CATEGORIES.drums.includes(sound) && !SOUND_CATEGORIES.percussion.includes(sound)
    && !SOUND_CATEGORIES.industrial.includes(sound);
}

export const prettySound = (s) => String(s).replace(/^gm_/, '').replace(/_/g, ' ');

// Step length options (cycles per step) used by clocks and sequencers.
export const STEP_LABEL = { 0.0625: '1/16', 0.125: '1/8', 0.25: '1/4', 0.5: '1/2', 1: '1 BAR', 2: '2 BARS' };
