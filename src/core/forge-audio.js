// Bonfire-only sounds: custom DSP registered into superdough, so patterns can play them with
// s("bf_string") and every superdough effect (FILTER, FX, pan, gain, the recorder) still applies
// after them. strudel.cc doesn't have these sounds; the compiler flags them in the code view.
import { getAudioContext, getFrequencyFromValue, registerSound } from '@strudel/webaudio';
import workletUrl from './forge-worklet.js?url';

let loading = null;

// Call after the AudioContext exists (inside unlockAudio). Safe to call repeatedly.
export function loadForge() {
  return (loading ??= getAudioContext().audioWorklet.addModule(workletUrl).then(registerForgeSounds));
}

function registerForgeSounds() {
  registerSound('bf_string', (t, value, onended) => {
    const ctx = getAudioContext();
    const duration = value.duration ?? 0.25;
    const release = value.release ?? 0.3;
    const stop = t + duration + release + 0.05;
    const node = new AudioWorkletNode(ctx, 'bonfire-string', {
      numberOfInputs: 0,
      outputChannelCount: [1],
      processorOptions: {
        freq: getFrequencyFromValue(value),
        start: t,
        end: t + duration,
        stop,
        decay: value.strdecay ?? 3,
        release,
        bright: value.strbright ?? 0.5,
        pick: value.strpick ?? 0.6,
      },
    });
    const out = new GainNode(ctx, { gain: 0.5 });
    node.connect(out);
    let ended = false;
    const finish = () => {
      if (ended) return;
      ended = true;
      node.disconnect();
      onended();
    };
    node.port.onmessage = (e) => e.data === 'done' && finish();
    return {
      node: out,
      stop: (time) => node.port.postMessage({ stop: time }),
    };
  }, { type: 'synth', prebake: true });
}
