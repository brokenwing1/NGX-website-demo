import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { tenantShells } from './build/tenant-shells.ts';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [
      react(),
      tenantShells({ siteUrl: env.PUBLIC_SITE_URL ?? '' }),
      VitePWA({
        // One service worker file for all studios; each studio registers it with its own scope
        // (/s/<slug>/) and gets its own cache names. Manifests are per studio (public/s/<slug>/).
        strategies: 'injectManifest',
        srcDir: 'src',
        filename: 'sw.ts',
        injectRegister: false,
        manifest: false,
        injectManifest: {
          rollupFormat: 'iife',
          globPatterns: ['assets/**/*.{js,css,woff2}'],
          maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        },
        devOptions: { enabled: false },
      }),
    ],
    server: { port: 5173, host: true },
    preview: { port: 4173, host: true },
    build: {
      target: 'es2022',
      sourcemap: true,
      chunkSizeWarningLimit: 1200,
    },
  };
});
