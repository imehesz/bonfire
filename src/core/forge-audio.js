// Bonfire-only sounds: custom DSP registered into superdough, so patterns can play them with
// s("bf_string") etc. and every superdough effect (FILTER, FX, pan, gain, the recorder) still
// applies after them. strudel.cc doesn't have these sounds; the compiler flags them in the code view.
// Each sound = one AudioWorklet processor in forge-worklet.js, one node per note.
import { getAudioContext, getFrequencyFromValue, registerSound } from '@strudel/webaudio';
import workletUrl from './forge-worklet.js?url';

let loading = null;

// Call after the AudioContext exists (inside unlockAudio). Safe to call repeatedly.
export function loadForge() {
  return (loading ??= getAudioContext().audioWorklet.addModule(workletUrl).then(registerForgeSounds));
}

// Registers sound `name` played by worklet `processor`. opts(value) -> the processor's own knobs;
// the timing (start / end / stop), pitch and attack / release are filled in here.
function workletSound(name, processor, opts, { outGain = 0.5, defaultRelease = 0.3, channels = 1 } = {}) {
  registerSound(name, (t, value, onended) => {
    const ctx = getAudioContext();
    const duration = value.duration ?? 0.25;
    const release = value.release ?? defaultRelease;
    const stop = t + duration + release + 0.05;
    const node = new AudioWorkletNode(ctx, processor, {
      numberOfInputs: 0,
      outputChannelCount: [channels],
      processorOptions: {
        freq: getFrequencyFromValue(value),
        start: t,
        end: t + duration,
        stop,
        attack: value.attack ?? 0,
        release,
        ...opts(value),
      },
    });
    const out = new GainNode(ctx, { gain: outGain });
    node.connect(out);
    let ended = false;
    node.port.onmessage = (e) => {
      if (e.data !== 'done' || ended) return;
      ended = true;
      node.disconnect();
      onended();
    };
    return { node: out, stop: (time) => node.port.postMessage({ stop: time }) };
  }, { type: 'synth', prebake: true });
}

function registerForgeSounds() {
  workletSound('bf_string', 'bonfire-string', (v) => ({
    decay: v.strdecay ?? 3,
    bright: v.strbright ?? 0.5,
    pick: v.strpick ?? 0.6,
  }));
  workletSound('bf_growl', 'bonfire-growl', (v) => ({
    wave: v.growlwave ?? 0,
    cutoff: v.growlcut ?? 400,
    res: v.growlres ?? 0.6,
    fm: v.growlfm ?? 2,
    ratio: v.growlratio ?? 1,
    fmdec: v.growldec ?? 0,
  }), { outGain: 0.8, defaultRelease: 0.1 });
  workletSound('bf_fold', 'bonfire-fold', (v) => ({
    fold: v.foldamt ?? 2,
    sym: v.foldsym ?? 0,
    bloom: v.foldbloom ?? 0,
    time: v.foldtime ?? 0.2,
  }), { outGain: 0.7, defaultRelease: 0.2 });
  workletSound('bf_acid', 'bonfire-acid', (v) => ({
    path: String(v.acidpath ?? '').split(',').filter(Boolean).map((s) => s.split(':').map(Number)),
    wave: v.acidwave ?? 0,
    cutoff: v.acidcut ?? 320,
    res: v.acidres ?? 0.75,
    envmod: v.acidenv ?? 0.55,
    decay: v.aciddec ?? 0.3,
    accent: v.acidacc ?? 0.6,
    glide: v.acidglide ?? 0.06,
  }), { outGain: 0.8, defaultRelease: 0.015 });
  workletSound('bf_modal', 'bonfire-modal', (v) => ({
    material: v.modalmat ?? 0,
    strike: v.modalstrike ?? 0.5,
    pos: v.modalpos ?? 0.2,
    decay: v.modaldecay ?? 1.5,
    damp: v.modaldamp ?? 0.5,
    stretch: v.modalstretch ?? 0,
  }), { outGain: 0.6, defaultRelease: 1 });
  workletSound('bf_hoover', 'bonfire-hoover', (v) => ({
    mode: v.hoovmode ?? 0,
    detune: v.hoovdet ?? 0.45,
    mix: v.hoovmix ?? 0.6,
    width: v.hoovwidth ?? 0.7,
    dip: v.hoovdip ?? 0,
    diptime: v.hoovdiptime ?? 0.15,
    sub: v.hoovsub ?? 0,
  }), { outGain: 0.7, defaultRelease: 0.3, channels: 2 });
}
