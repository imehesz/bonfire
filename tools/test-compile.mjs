// Compiles every demo patch and evaluates the generated code with the real
// Strudel transpiler — proves the exported code runs as-is on strudel.cc.
// Run: npm test   (add --print to see the code)
import fs from 'node:fs';
import { compilePatch } from '../src/core/compile.js';
import { MODULES, defaultParams } from '../src/modules/index.js';
import { run } from './strudel-node.mjs';

export async function main(args) {
  let failed = 0;
  const check = async (label, patch) => {
    const { code, errors } = compilePatch(patch);
    if (args.includes('--print')) console.log(`\n----- ${label}\n${code}`);
    try {
      if (errors.length) throw new Error(errors.join('; '));
      const haps = await run(code, 4);
      if (!haps.length && !code.includes('silence')) throw new Error('no events in 4 cycles');
      console.log(`ok   ${label} (${haps.length} events)`);
    } catch (e) {
      failed++;
      console.log(`FAIL ${label}: ${e.message}\n${code}`);
    }
  };
  for (const f of fs.readdirSync('public/demos').filter((f) => f.endsWith('.json') && f !== 'index.json')) {
    await check(`demo ${f}`, JSON.parse(fs.readFileSync(`public/demos/${f}`, 'utf8')));
  }
  // Every module alone with defaults, patched straight into OUTPUT where possible.
  for (const def of Object.values(MODULES)) {
    const outs = Object.entries(def.outputs).filter(([, o]) => ['pattern', 'pitch'].includes(o.type));
    for (const [jack] of outs) {
      const mods = [{ id: 'm1', type: def.type, params: defaultParams(def.type) }, { id: 'out1', type: 'output', params: {} }];
      const cables = [{ from: { m: 'm1', j: jack }, to: { m: 'out1', j: 'r' } }];
      if (def.inputs.in) { // processors need a source
        mods.push({ id: 's1', type: 'seq', params: defaultParams('seq') });
        cables.push({ from: { m: 's1', j: 'pat' }, to: { m: 'm1', j: 'in' } });
      }
      await check(`module ${def.type}.${jack}`, { modules: mods, cables });
    }
  }
  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  return failed ? 1 : 0;
}
