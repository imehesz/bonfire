// MIDI clock OUT: 24 ticks per quarter note (96 per bar = one Strudel cycle) to
// one chosen output port, START on the first bar after PLAY, STOP on STOP.
// Ticks are timestamped ahead of time (Web MIDI send(bytes, performanceTime)) so
// timer jitter doesn't reach the cable. Settings live in localStorage, not the
// patch: they describe this computer's wiring, not the song.
import { getAudioContext } from '@strudel/webaudio';
import * as engine from './engine.js';
import { midiOutput } from './midi.js';

const KEY = 'bonfire.midi.clock';
const TICKS = 96; // per cycle (4 beats x 24 PPQN)
const AHEAD = 0.12; // seconds scheduled ahead of the audio
const POLL = 20; // ms

const START = 0xfa, STOP = 0xfc, TICK = 0xf8;

let prefs = { port: null, offset: 0 };
try { prefs = { ...prefs, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { /* ignore */ }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* ignore */ } };

export const clockPrefs = () => ({ ...prefs });
export function setClockPort(port) {
  if (prefs.port && prefs.port !== port && running) midiOutput(prefs.port)?.send([STOP]);
  prefs.port = port || null;
  running = false; // restart cleanly on the new port
  save();
}
// Positive = the hardware hears the clock later (use when it runs ahead of Bonfire).
export function setClockOffset(ms) {
  prefs.offset = Math.max(-150, Math.min(150, Math.round(ms)));
  save();
}

// AudioContext time -> performance.now() time at which that moment is HEARD
// (getOutputTimestamp includes the output latency), plus the user's offset.
function toPerf(ctx, t) {
  const ts = ctx.getOutputTimestamp?.();
  const base = ts?.performanceTime ? ts : { contextTime: ctx.currentTime, performanceTime: performance.now() };
  return base.performanceTime + (t - base.contextTime) * 1000 + prefs.offset;
}

let running = false; // START sent, ticking
let next = 0; // next tick index (cycle = next / TICKS)

function poll() {
  const out = midiOutput(prefs.port);
  if (!out || !engine.isPlaying()) {
    if (running) out?.send([STOP]);
    running = false;
    return;
  }
  // null for a moment after every tempo change too: just wait, don't STOP
  const clk = engine.cycleClock();
  if (!clk) return;
  const ctx = getAudioContext();
  const horizon = ctx.currentTime + AHEAD;
  if (!running) {
    // Start on the next bar line that is still in the future.
    next = Math.max(0, Math.ceil(clk.cycleAt(ctx.currentTime + 0.03))) * TICKS;
    if (clk.at(next / TICKS) > horizon) return;
    out.send([START], toPerf(ctx, clk.at(next / TICKS)));
    running = true;
  }
  // Fell far behind (background tab, tempo jump): skip to now rather than burst.
  const late = Math.ceil(clk.cycleAt(ctx.currentTime - 0.05) * TICKS);
  if (next < late) next = late;
  const nowPerf = performance.now();
  for (let i = 0; i < 64; i++) {
    const t = clk.at(next / TICKS);
    if (t > horizon) break;
    out.send([TICK], Math.max(nowPerf, toPerf(ctx, t)));
    next++;
  }
}

setInterval(poll, POLL);

// Middle C on every channel for 0.3 s: which port reaches the hardware?
export function testNote(port) {
  const out = midiOutput(port);
  if (!out) return false;
  const t = performance.now();
  for (let ch = 0; ch < 16; ch++) {
    out.send([0x90 | ch, 60, 100], t);
    out.send([0x80 | ch, 60, 0], t + 300);
  }
  return true;
}
