// Loads a module through Vite's SSR pipeline with every dependency inlined, so
// browser-first packages (@strudel/*, tonal) run under Node. Usage:
//   node tools/run-node.mjs <module path> [args...]
import { createServer } from 'vite';
import path from 'node:path';
import fs from 'node:fs';
import Module from 'node:module';

// Some @tonaljs packages declare "main": dist/index.js but only ship index.cjs;
// chord-voicings require()s them from plain Node, so redirect those lookups.
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  try {
    return origResolve.call(this, request, ...rest);
  } catch (e) {
    const cjs = e.path && path.join(path.dirname(e.path), 'dist/index.cjs');
    if (/@tonaljs/.test(request) && cjs && fs.existsSync(cjs)) return cjs;
    throw e;
  }
};

const [target, ...args] = process.argv.slice(2);
const server = await createServer({
  configFile: false,
  root: process.cwd(),
  logLevel: 'error',
  server: { middlewareMode: true, hmr: false },
  ssr: { noExternal: [/^@strudel\//, /^@kabelsalat\//, /^@tonaljs\//, 'superdough', 'supradough'] },
  optimizeDeps: { noDiscovery: true, include: [] },
});
let code = 0;
try {
  const mod = await server.ssrLoadModule(path.resolve(target));
  if (typeof mod.main === 'function') code = (await mod.main(args)) ?? 0;
} catch (e) {
  console.error(e);
  code = 1;
} finally {
  await server.close();
}
process.exit(code);
