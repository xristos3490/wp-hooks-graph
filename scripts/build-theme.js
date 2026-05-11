#!/usr/bin/env node
/**
 * Assemble packages/theme/ for distribution as a WordPress classic theme:
 *   1. Build the viewer (pnpm -F @hooksgraph/viewer build).
 *   2. Copy viewer dist → packages/theme/assets/.
 *   3. Extract the emitted entry JS + CSS filenames from dist/index.html and
 *      write packages/theme/assets/manifest.json so functions.php can enqueue
 *      hashed filenames without parsing HTML at runtime.
 */
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const VIEWER = path.join(ROOT, 'packages/viewer');
const THEME = path.join(ROOT, 'packages/theme');
const THEME_ASSETS = path.join(THEME, 'assets');

function run(cmd, args, opts = {}) {
  process.stderr.write(`\n▶ ${cmd} ${args.join(' ')}\n`);
  const result = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (result.status !== 0) {
    process.stderr.write(`\nCommand failed: ${cmd} ${args.join(' ')}\n`);
    process.exit(result.status ?? 1);
  }
}

function reset(dir) {
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
}

/**
 * Parse the Vite-built dist/index.html for the entry module script and the
 * primary stylesheet. Vite emits both with `assets/` prefixes when `base: './'`.
 */
function extractEntryAssets(html) {
  const jsMatch = html.match(/<script[^>]+type=["']module["'][^>]+src=["']([^"']+)["']/i);
  const cssMatch = html.match(/<link[^>]+rel=["']stylesheet["'][^>]+href=["']([^"']+)["']/i);
  if (!jsMatch) {
    throw new Error('build-theme: could not find <script type="module" src="…"> in dist/index.html');
  }
  if (!cssMatch) {
    throw new Error('build-theme: could not find <link rel="stylesheet" href="…"> in dist/index.html');
  }
  return {
    js: jsMatch[1].replace(/^\.?\//, ''),
    css: cssMatch[1].replace(/^\.?\//, ''),
  };
}

process.stderr.write(`Building theme assets at ${THEME}\n`);

run('pnpm', ['-F', '@hooksgraph/viewer', 'build'], { cwd: ROOT });

const viewerDist = path.join(VIEWER, 'dist');
if (!existsSync(viewerDist)) {
  process.stderr.write(`\nViewer dist not found at ${viewerDist}\n`);
  process.exit(1);
}

reset(THEME_ASSETS);

// Copy only the hashed JS/CSS bundle from dist/assets/. The viewer's top-level
// static files (favicon.svg, og-image.png) and index.html are owned by the
// viewer for its standalone CLI server flow — the theme has its own committed
// copies at packages/theme/ (favicon.svg, favicon.png, og-image.png, screenshot.png).
const distAssetsDir = path.join(viewerDist, 'assets');
if (existsSync(distAssetsDir)) {
  for (const name of readdirSync(distAssetsDir)) {
    cpSync(path.join(distAssetsDir, name), path.join(THEME_ASSETS, name), { recursive: true });
  }
}

const indexHtmlPath = path.join(viewerDist, 'index.html');
const indexHtml = readFileSync(indexHtmlPath, 'utf8');
const manifest = extractEntryAssets(indexHtml);
// Strip the dist-relative "assets/" prefix — files now sit at THEME_ASSETS root.
manifest.js = manifest.js.replace(/^assets\//, '');
manifest.css = manifest.css.replace(/^assets\//, '');

writeFileSync(
  path.join(THEME_ASSETS, 'manifest.json'),
  JSON.stringify(manifest, null, 2) + '\n'
);

process.stderr.write(`\n✓ Theme assets ready: ${THEME}\n`);
process.stderr.write(`  js:  ${manifest.js}\n`);
process.stderr.write(`  css: ${manifest.css}\n`);
