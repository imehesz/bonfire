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

  // STEMS: every patched, unmuted channel of every MIXER can be exported on its own. A sound can
  // only sit on one Strudel orbit, so each BOTTOM channel (nothing mixed into it from another
  // MIXER) gets its own orbit (100, 200, ...) and a channel fed by a sub-MIXER is the sum of that
  // mixer's orbits; the recorder sums orbits per stem, so any mix of levels exports in one pass.
  // DUCKs inside a bottom channel take base + n; a DUCK after a sub-MIXER ducks all its orbits.
  // Channels of the MIXERs feeding OUTPUT are the suggested (preselected) stems.
  const tops = topMixers(out, inputs, byId);
  const stemOf = {}; // module id -> its bottom channel's base orbit
  const chanOrbits = {}; // mixer id -> { ch: base } for bottom channels (the MIXER adds keep(orbit))
  const mixerOrbits = new Map(); // mixer id -> Set of every orbit under it
  const stems = [];
  let nextBase = 100;
  function visit(mixer) {
    if (mixerOrbits.has(mixer.id)) return mixerOrbits.get(mixer.id);
    const all = new Set();
    mixerOrbits.set(mixer.id, all);
    if (mixer.params.muteAll) return all;
    for (let i = 0; i < 4; i++) {
      const src = inputs[mixer.id]?.[`in${i}`];
      if (!src || !byId[src.m] || mixer.params[`mute${i}`]) continue;
      const below = new Set(); // orbits of MIXERs anywhere upstream of this channel
      const seen = new Set();
      (function scan(id) {
        if (!id || seen.has(id) || !byId[id]) return;
        seen.add(id);
        if (byId[id].type === 'mixer') return visit(byId[id]).forEach((o) => below.add(o));
        for (const x of Object.values(inputs[id] ?? {})) scan(x.m);
      })(src.m);
      const orbits = new Set(below);
      if (!throughPass(src.m, inputs, byId, (m) => m.type === 'mixer')) {
        // a bottom channel (or one that also carries its own sounds): give it an orbit
        const base = nextBase;
        nextBase += 100;
        orbits.add(base);
        (chanOrbits[mixer.id] ??= {})[i] = base;
        for (const id of seen) if (byId[id].type !== 'mixer' && stemOf[id] == null) stemOf[id] = base;
      }
      stems.push({ mixer: mixer.id, ch: i, name: stemName(src.m, inputs, byId), orbits, top: tops.has(mixer.id) });
      orbits.forEach((o) => all.add(o));
    }
    return all;
  }
  for (const m of tops) visit(byId[m]);
  for (const m of patch.modules) if (m.type === 'mixer' && reachable.has(m.id)) visit(m);
  // orbits of every MIXER upstream of `id` (the DUCK uses this to duck a whole sub-mix)
  function mixersAbove(id) {
    const outSet = new Set();
    const seen = new Set();
    (function scan(x) {
      if (!x || seen.has(x) || !byId[x]) return;
      seen.add(x);
      if (byId[x].type === 'mixer') return visit(byId[x]).forEach((o) => outSet.add(o));
      for (const y of Object.values(inputs[x] ?? {})) scan(y.m);
    })(id);
    return [...outSet].sort((p, q) => p - q);
  }
  const usedOrbits = new Set();

  const results = {};
  const hoisted = {};
  const decls = [];
  const meta = {};
  const errors = [];
  const preludes = new Map(); // helper definitions a module needs above the patch (one copy each)

  function compileModule(id) {
    if (results[id]) return results[id];
    const mod = byId[id];
    const def = MODULES[mod.type];
    results[id] = {}; // guard against cycles sneaking in through a bad file
    const ctx = {
      id,
      p: { ...defaultParams(mod.type), ...mod.params },
      global,
      in: (jack) => resolve(inputs[id]?.[jack]),
      meta: (m) => (meta[id] = m),
      prelude: (key, text) => reachable.has(id) && preludes.set(key, text), // unpatched modules add nothing
      stemOrbit: stemOf[id] ?? null, // the base orbit of the bottom MIXER channel this module feeds
      stemOrbits: chanOrbits[id] ?? null, // MIXER only: { ch: orbit } for its bottom channels
      orbitsAbove: (jack) => (inputs[id]?.[jack] ? mixersAbove(inputs[id][jack].m) : []),
      useOrbit: (o) => reachable.has(id) && usedOrbits.add(o), // DUCK reports its private orbit
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
  // a pack is a strudel.json URL, or a { name: audioUrl } map for loose files.
  // Relative audio URLs (files in public/samples/) are printed absolute against
  // the page, so the code still finds them when pasted into strudel.cc.
  const absUrl = (u) => (/^[a-z][a-z0-9+.-]*:/i.test(u) || typeof document === 'undefined' ? u
    : new URL(u, document.baseURI).href);
  for (const pack of patch.samplePacks ?? []) {
    lines.push(typeof pack === 'string' ? `samples('${pack}')`
      : `samples({ ${Object.entries(pack).map(([n, u]) => `${n}: '${absUrl(u)}'`).join(', ')} })`);
  }
  lines.push(`setcpm(${bpm}/4)`, '');
  if (preludes.size) lines.push(...preludes.values(), '');
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

  // Bonfire-only modules (strudel: false) that actually reach OUTPUT: say so up top
  const forge = patch.modules.filter((m) => reachable.has(m.id) && MODULES[m.type]?.strudel === false);
  if (forge.length) {
    const names = [...new Set(forge.map((m) => MODULES[m.type].name))].join(', ');
    const n = forge.length === 1 ? '1 module' : `${forge.length} modules`;
    code = code.replace('\n', `\n// You are using ${n} that Strudel does not support (${names}).\n// This code only plays inside Bonfire STACK, not on strudel.cc.\n`);
  }

  // a DUCK's private orbit belongs to every stem holding its channel's base orbit
  for (const o of usedOrbits) for (const st of stems) if (st.orbits.has(Math.floor(o / 100) * 100)) st.orbits.add(o);
  const loose = [1, ...[...usedOrbits].filter((o) => o < 100)];
  return {
    code, meta, errors, bpm, playing: !!main, reachable, unsupported: forge.length,
    // tops first, then the rest in the order found
    stems: [...stems.filter((x) => x.top), ...stems.filter((x) => !x.top)]
      .map((x) => ({ mixer: x.mixer, ch: x.ch, name: x.name, orbits: [...x.orbits].sort((p, q) => p - q), suggested: x.top })),
    looseOrbits: loose,
  };
}

// Modules that pass one IN straight through (so a MIXER behind them is still "the master").
const PASS = new Set(['fx', 'vintage', 'tape', 'filter', 'fenv', 'vandal', 'duck', 'octave']);

// Walks back from `id` through one-in PASS modules; true if it lands on a module matching `test`.
function throughPass(id, inputs, byId, test) {
  let m = byId[id];
  for (let guard = 0; m && guard < 50; guard++) {
    if (test(m)) return true;
    if (!PASS.has(m.type)) return false;
    const src = inputs[m.id]?.in;
    m = src ? byId[src.m] : null;
  }
  return false;
}

// The MIXERs feeding OUTPUT (L and/or R), maybe through FX-type modules: the suggested stems.
function topMixers(out, inputs, byId) {
  const found = new Set();
  if (!out) return found;
  for (const src of Object.values(inputs[out.id] ?? {})) {
    let m = byId[src.m];
    for (let guard = 0; m && guard < 50; guard++) {
      if (m.type === 'mixer') {
        found.add(m.id);
        break;
      }
      if (!PASS.has(m.type)) break;
      const s2 = inputs[m.id]?.in;
      m = s2 ? byId[s2.m] : null;
    }
  }
  return found;
}

// A stem is named after what feeds that channel: its label if it has one, else the first labelled /
// sound-making module up the chain (skipping FX-type modules), else the module id.
function stemName(id, inputs, byId) {
  const seen = new Set();
  let m = byId[id];
  while (m && !seen.has(m.id)) {
    seen.add(m.id);
    if (m.label) return m.label;
    if (!PASS.has(m.type)) return m.id;
    const src = inputs[m.id]?.in;
    m = src ? byId[src.m] : null;
  }
  return byId[id]?.label || id;
}
