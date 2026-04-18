import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

function hooksJsonPlugin() {
  let jsonPath = null;

  return {
    name: 'hooks-json',
    configResolved() {
      const args = process.argv;
      const idx = args.indexOf('--json');
      if (idx !== -1 && args[idx + 1]) {
        jsonPath = resolve(args[idx + 1]);
      }
    },
    configureServer(server) {
      server.middlewares.use('/api/hooks.json', (req, res) => {
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
  plugins: [react(), hooksJsonPlugin()],
  server: {
    port: 8080,
    strictPort: false,
  },
  build: {
    outDir: 'dist',
  },
});
