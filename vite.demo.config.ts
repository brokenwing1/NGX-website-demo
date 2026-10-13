// Single-file demo build (pnpm demo:build). Same app; src/lib/supabase.ts is swapped for the
// in-memory backend, everything is bundled into one script, no service worker, no per-studio shells.
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const REAL = resolve(import.meta.dirname, 'src/lib/supabase.ts');
const DEMO = resolve(import.meta.dirname, 'src/demo/supabase-demo.ts');

const DATA = resolve(import.meta.dirname, 'src/demo/data.generated.json');

function demoBackend(): Plugin {
  return {
    name: 'demo-backend',
    enforce: 'pre',
    load(id) {
      // demo studios, photos and owner logins prepared by scripts/build-demo.ts
      if (id === '\0virtual:demo-data') return `export default ${readFileSync(DATA, 'utf8')};`;
      return null;
    },
    async resolveId(source, importer, options) {
      if (source === 'virtual:demo-data') return '\0virtual:demo-data';
      if (!importer || importer === DEMO) return null;
      const r = await this.resolve(source, importer, { ...options, skipSelf: true });
      return r && r.id === REAL ? DEMO : null;
    },
  };
}

export default defineConfig({
  plugins: [react(), demoBackend()],
  base: './',
  build: {
    outDir: 'dist-demo',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    chunkSizeWarningLimit: 10_000,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
