import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import dsTokenFallbacksPostcss from '@wordpress/theme/postcss-plugins/postcss-ds-token-fallbacks';
import dsTokenFallbacksVite from '@wordpress/theme/vite-plugins/vite-ds-token-fallbacks';

function hooksJsonPlugin() {
  let jsonPath = null;

  return {
    name: 'hooks-json',
    configResolved() {
      // Prefer the env var — Vite 8's CAC parser rejects unknown CLI flags
      // before plugins run, so `--json` can no longer be read from process.argv.
      if (process.env.HOOKSGRAPH_JSON) {
        jsonPath = resolve(process.env.HOOKSGRAPH_JSON);
        return;
      }
      const args = process.argv;
      const idx = args.indexOf('--json');
      if (idx !== -1 && args[idx + 1]) {
        jsonPath = resolve(args[idx + 1]);
      }
    },
    configureServer(server) {
      server.middlewares.use('/hooks.json', (req, res) => {
        if (!jsonPath || !existsSync(jsonPath)) {
          res.statusCode = 404;
          res.end('');
          return;
        }
        res.setHeader('Content-Type', 'application/json');
        res.end(readFileSync(jsonPath, 'utf-8'));
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), hooksJsonPlugin(), dsTokenFallbacksVite()],
  css: {
    postcss: {
      plugins: [dsTokenFallbacksPostcss()],
    },
  },
  server: {
    port: 8080,
    strictPort: false,
  },
  build: {
    outDir: 'dist',
  },
});
