// Evaluates Strudel code in Node with the real transpiler + core/mini/tonal,
// so generated patches can be checked for REPL compatibility without a browser.
import * as core from '@strudel/core';
import * as mini from '@strudel/mini';
import * as tonal from '@strudel/tonal';
import { evaluate as transpileEval } from '@strudel/transpiler';

let scoped = false;
export async function setup() {
  if (scoped) return;
  scoped = true;
  const stubs = {
    setcpm: (v) => (stubs.__cpm = v), setCpm: (v) => (stubs.__cpm = v),
    setcps: (v) => (stubs.__cps = v), samples: () => {}, hush: () => {},
  };
  await core.evalScope(core, mini, tonal, stubs);
  mini.miniAllStrings();
}

export async function run(code, cycles = 2) {
  await setup();
  const { pattern } = await transpileEval(code);
  if (!pattern || typeof pattern.queryArc !== 'function') throw new Error('code did not return a pattern');
  return pattern.queryArc(0, cycles).filter((h) => h.hasOnset());
}
