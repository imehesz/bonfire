// Web MIDI input. Listens to every connected device on every channel and hands
// out parsed messages, so any controller works: mappings key on the message
// (CC 74 on channel 1), never on the device that sent it.
//   { kind: 'cc' | 'pb', src, value 0..1, raw }   knobs, faders, buttons, wheels (raw: CC byte)
//   { kind: 'note', src, note, vel 0..1, on }      keys and pads
import { midiToNote } from './music.js';

const PREF_KEY = 'bonfire.midi';

let access = null;
let asking = null;
const listeners = new Set();
const owners = new Map(); // src -> { port, t } (see bindInputs)
const dropListeners = new Set(); // copies from a second port, for the diagnostic log
export const onMidiDropped = (fn) => (dropListeners.add(fn), () => dropListeners.delete(fn));
const stateListeners = new Set();
const state = { enabled: false, error: null, devices: [] };

export const midiSupported = () => typeof navigator !== 'undefined' && !!navigator.requestMIDIAccess;
export const midiState = () => ({ supported: midiSupported(), secure: globalThis.isSecureContext !== false, ...state });
export const onMidi = (fn) => (listeners.add(fn), () => listeners.delete(fn));
export const onMidiState = (fn) => (stateListeners.add(fn), () => stateListeners.delete(fn));
const emitState = () => stateListeners.forEach((fn) => fn(midiState()));

function parse(data) {
  const [st, d1 = 0, d2 = 0] = data;
  if (st >= 0xf0) return null; // clock, active sensing, sysex
  const ch = (st & 0x0f) + 1;
  const type = st & 0xf0;
  if (type === 0xb0) return { kind: 'cc', src: `cc:${ch}:${d1}`, value: d2 / 127, raw: d2 };
  if (type === 0x90 && d2 > 0) return { kind: 'note', src: `note:${ch}:${d1}`, note: d1, vel: d2 / 127, on: true };
  if (type === 0x80 || type === 0x90) return { kind: 'note', src: `note:${ch}:${d1}`, note: d1, vel: 0, on: false };
  if (type === 0xe0) return { kind: 'pb', src: `pb:${ch}`, value: ((d2 << 7) | d1) / 16383 };
  return null;
}

function bindInputs() {
  state.devices = [];
  for (const input of access.inputs.values()) {
    input.onmidimessage = (e) => {
      const msg = parse(e.data);
      if (!msg) return;
      msg.port = input.name || input.id;
      msg.bytes = [...e.data];
      msg.t = e.timeStamp;
      // Multi-port controllers (the SMK-37) send every message on two ports. The
      // first port to send a control owns it; copies from the others are dropped
      // until the owner has been quiet for a second.
      const own = owners.get(msg.src);
      if (own && own.port !== msg.port && msg.t - own.t < 1000) return dropListeners.forEach((fn) => fn(msg));
      owners.set(msg.src, { port: msg.port, t: msg.t });
      listeners.forEach((fn) => fn(msg));
    };
    if (input.state === 'connected') state.devices.push(input.name || 'MIDI device');
  }
  emitState();
}

export function enableMidi() {
  if (access) return Promise.resolve(true);
  if (!midiSupported()) {
    state.error = 'This browser has no Web MIDI.';
    emitState();
    return Promise.resolve(false);
  }
  asking ??= navigator.requestMIDIAccess({ sysex: false }).then((a) => {
    access = a;
    access.onstatechange = bindInputs; // hot-plug
    state.enabled = true;
    state.error = null;
    try { localStorage.setItem(PREF_KEY, '1'); } catch { /* ignore */ }
    bindInputs();
    return true;
  }, (e) => {
    asking = null;
    state.error = e?.name === 'SecurityError' || e?.name === 'NotAllowedError' ? 'MIDI permission was refused.' : (e?.message ?? String(e));
    emitState();
    return false;
  });
  return asking;
}

export function disableMidi() {
  if (access) {
    for (const input of access.inputs.values()) input.onmidimessage = null;
    access.onstatechange = null;
  }
  access = null;
  asking = null;
  state.enabled = false;
  state.devices = [];
  try { localStorage.removeItem(PREF_KEY); } catch { /* ignore */ }
  emitState();
}

// Turned on in an earlier visit: the browser remembers the permission, so no prompt.
export function restoreMidi() {
  let on = false;
  try { on = localStorage.getItem(PREF_KEY) === '1'; } catch { /* ignore */ }
  if (on) enableMidi();
}

// 'cc:1:74' -> 'CC 74', with the channel only when it isn't 1
export function srcLabel(src) {
  const [kind, ch, num] = src.split(':');
  const chan = ch === '1' ? '' : ` · CH ${ch}`;
  if (kind === 'cc') return `CC ${num}${chan}`;
  if (kind === 'note') return `KEY ${midiToNote(Number(num)).toUpperCase()}${chan}`;
  if (kind === 'pb') return `PITCH BEND${chan}`;
  return src;
}
