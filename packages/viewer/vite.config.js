import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
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
          // 204 (not 404) — the homepage probes this endpoint and "no JSON bound" is a normal state.
          res.statusCode = 204;
          res.end();
          return;
        }
        res.setHeader('Content-Type', 'application/json');
        res.end(readFileSync(jsonPath, 'utf-8'));
      });
    },
  };
}

function demoJsonPlugin() {
  const parsedDir = resolve(__dirname, 'public/parsed');

  function firstJson() {
    if (!existsSync(parsedDir) || !statSync(parsedDir).isDirectory()) return null;
    const files = readdirSync(parsedDir)
      .filter((f) => f.toLowerCase().endsWith('.json'))
      .sort();
    return files.length ? join(parsedDir, files[0]) : null;
  }

  return {
    name: 'demo-json',
    configureServer(server) {
      server.middlewares.use('/demo.json', (req, res) => {
        const file = firstJson();
        if (!file) {
          res.statusCode = 204;
          res.end();
          return;
        }
        res.setHeader('Content-Type', 'application/json');
        res.end(readFileSync(file, 'utf-8'));
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), hooksJsonPlugin(), demoJsonPlugin(), dsTokenFallbacksVite()],
  css: {
    postcss: {
      plugins: [dsTokenFallbacksPostcss()],
    },
  },
  server: {
    port: 8080,
    strictPort: false,
  },
  base: './',
  build: {
    outDir: 'dist',
  },
});
