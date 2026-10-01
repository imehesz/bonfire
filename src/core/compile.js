// Patch graph -> Strudel REPL code.
// Walks backwards from the OUTPUT module, compiling each module once. Outputs
// that feed more than one input are hoisted into `const` declarations so the
// generated code stays readable and identical to what plays.
import { Expr, Raw, ident, printExpr } from './expr.js';
import { MODULES, defaultParams } from '../modules/index.js';

const HOIST_MIN_LEN = 18;

export function inputMap(patch) {
  const map = {};
  for (const c of patch.cables) (map[c.to.m] ??= {})[c.to.j] = c.from;
  return map;
}

// True if adding from -> to would close a loop (to already reaches from).
export function wouldCycle(patch, fromModule, toModule) {
  if (fromModule === toModule) return true;
  const seen = new Set();
  const stack = [toModule];
  while (stack.length) {
    const m = stack.pop();
    if (m === fromModule) return true;
    if (seen.has(m)) continue;
    seen.add(m);
    for (const c of patch.cables) if (c.from.m === m) stack.push(c.to.m);
  }
  return false;
}

export function compilePatch(patch) {
  const byId = Object.fromEntries(patch.modules.map((m) => [m.id, m]));
  const inputs = inputMap(patch);
  const clockMod = patch.modules.find((m) => m.type === 'clock');
  const bpm = clockMod ? clockMod.params.bpm : 120;
  const global = { bpm };
  const out = patch.modules.find((m) => m.type === 'output');

  // Reference counts over the part of the graph that actually reaches OUTPUT.
  const refs = {};
  const reachable = new Set();
  (function walk(id) {
    if (!id || reachable.has(id)) return;
    reachable.add(id);
    for (const src of Object.values(inputs[id] ?? {})) {
      const key = `${src.m}.${src.j}`;
      refs[key] = (refs[key] ?? 0) + 1;
      walk(src.m);
    }
  })(out?.id);

  const results = {};
  const hoisted = {};
  const decls = [];
  const meta = {};
  const errors = [];

  function compileModule(id) {
    if (results[id]) return results[id];
    const mod = byId[id];
    const def = MODULES[mod.type];
    results[id] = {}; // guard against cycles sneaking in through a bad file
    const ctx = {
      p: { ...defaultParams(mod.type), ...mod.params },
      global,
      in: (jack) => resolve(inputs[id]?.[jack]),
      meta: (m) => (meta[id] = m),
    };
    try {
      results[id] = def.compile(ctx) ?? {};
    } catch (e) {
      errors.push(`${mod.id}: ${e.message}`);
      results[id] = {};
    }
    return results[id];
  }

  function resolve(src) {
    if (!src || !byId[src.m]) return null;
    const key = `${src.m}.${src.j}`;
    if (hoisted[key]) return hoisted[key];
    const value = compileModule(src.m)[src.j] ?? null;
    if (!(value instanceof Expr) || (refs[key] ?? 0) < 2) return value;
    const text = printExpr(value);
    if (text.length < HOIST_MIN_LEN) return value;
    const multi = Object.keys(MODULES[byId[src.m].type].outputs).length > 1;
    const name = multi ? `${src.m}_${src.j}` : src.m;
    decls.push(`const ${name} = ${printExpr(value)}`);
    hoisted[key] = ident(name);
    return hoisted[key];
  }

  // Compile everything (even unpatched modules) so their LEDs/playheads have meta.
  const main = out ? compileModule(out.id).main : null;
  for (const m of patch.modules) compileModule(m.id);

  const lines = [`// Bonfire STACK${patch.name ? ` · ${patch.name}` : ''}`];
  for (const pack of patch.samplePacks ?? []) lines.push(`samples('${pack}')`);
  lines.push(`setcpm(${bpm}/4)`, '');
  if (decls.length) lines.push(...decls, '');
  if (main) {
    lines.push(main instanceof Raw ? main.text : printExpr(main));
  } else {
    lines.push(out ? '// patch something into OUTPUT to hear it' : '// add an OUTPUT module to hear anything', 'silence');
  }
  let code = lines.join('\n');

  const local = (patch.localSounds ?? []).filter((n) => new RegExp(`["\\s(]${n}[\\s"*:(!~\\]]`).test(code));
  if (local.length) {
    code = code.replace('\n', `\n// local samples (not on strudel.cc unless imported there): ${local.join(', ')}\n`);
  }

  return { code, meta, errors, bpm, playing: !!main, reachable };
}
