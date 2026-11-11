import fs from 'node:fs';
import { defineConfig } from 'vite';

// Build version: v1.0.<YYYYMMDDHHMM> in local time, e.g. v1.0.202610021339.
// Every `npm run build` writes it to version.txt, appends it to the built
// index.html's JS/CSS URLs as ?v= (cache busting) and shows it in ⚙ Settings.
const pad = (n) => String(n).padStart(2, '0');
function buildVersion() {
  const d = new Date();
  return `v1.0.${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function versionPlugin(version) {
  return {
    name: 'bonfire-version',
    apply: 'build',
    buildStart() {
      fs.writeFileSync('version.txt', `${version}\n`);
    },
    // also inside dist/: sites that load engine.js from here read it to get past browser caches
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.txt', source: `${version}\n` });
    },
    transformIndexHtml: {
      order: 'post',
      handler: (html) => html.replace(/((?:src|href)="\.\/assets\/[^"?]+\.(?:js|css))"/g, `$1?v=${version}"`),
    },
  };
}

// base './' so the build runs from any sub-path on the server.
export default defineConfig(({ command }) => {
  const version = command === 'build' ? buildVersion() : 'dev';
  return {
    base: './',
    define: { __APP_VERSION__: JSON.stringify(version) },
    plugins: [versionPlugin(version)],
    build: {
      target: 'es2022',
      chunkSizeWarningLimit: 2500,
      // two entries: the app, and the engine on its own under a FIXED name (engine.js, no hash) so
      // other sites can import the newest engine from the app's URL (see src/player-engine.js)
      rollupOptions: {
        input: { index: 'index.html', engine: 'src/player-engine.js' },
        preserveEntrySignatures: 'exports-only', // keep engine.js's exports (an app build drops them by default)
        output: { entryFileNames: (chunk) => (chunk.name === 'engine' ? 'engine.js' : 'assets/[name]-[hash].js') },
      },
    },
  };
});
