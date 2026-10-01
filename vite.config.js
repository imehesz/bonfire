import { defineConfig } from 'vite';

// base './' so the build runs from any sub-path on the server.
export default defineConfig({
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 2500 },
});
