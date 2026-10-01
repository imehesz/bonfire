// Strudel bootstrap built from the individual packages (what @strudel/web does,
// minus its prebundled copy of core — that duplicate broke the soundfonts).
import * as core from '@strudel/core';
import * as mini from '@strudel/mini';
import * as tonal from '@strudel/tonal';
import * as webaudio from '@strudel/webaudio';
import { evaluate, transpiler } from '@strudel/transpiler';

export async function initStrudel({ prebake, ...options } = {}) {
  mini.miniAllStrings();
  const repl = webaudio.webaudioRepl({ ...options, transpiler });
  core.setTime(() => repl.scheduler.now());
  await core.evalScope(core, mini, tonal, webaudio, { evaluate, hush: () => repl.stop() });
  await Promise.all([webaudio.registerSynthSounds(), prebake?.()]);
  return repl;
}
