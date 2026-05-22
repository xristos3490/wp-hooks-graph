# @hooksgraph/viewer

Vite + React app that renders a parsed WordPress hooks graph via Sigma (WebGL) on top of a graphology `Graph`.

Private (`"private": true`) — never published to npm. The built bundle (`dist/`) is consumed by:

- the [`@hooksgraph/hooksgraph` CLI](../cli/) (`hooksgraph serve` and the parse-and-open shortcut),
- the [`@hooksgraph/theme`](../theme/) classic WordPress theme,
- or any static host (drop `dist/` next to a parsed `hooks.json`).

## Quick start

From the monorepo root:

```sh
pnpm install
pnpm dev:viewer
# → http://localhost:8080
```

Bind a specific parsed JSON to the dev server's `/hooks.json`:

```sh
HOOKSGRAPH_JSON=/abs/path/hooks.json pnpm dev:viewer
```

The viewer also accepts a graph at runtime via the homepage upload prompt, or via `window.HOOKSGRAPH_JSON_URL` when embedded (see [theme](../theme/)).

## Build

```sh
pnpm build:viewer
# → packages/viewer/dist/ (self-contained static bundle)
```

`dist/` works on any static host — GitHub Pages, Netlify, S3, an Nginx box. Ship a parsed `hooks.json` alongside it (default fetch path is `./hooks.json`).

## Useful commands

| Command                              | Description                                       |
| ------------------------------------ | ------------------------------------------------- |
| `pnpm dev:viewer`                    | Vite dev server on port 8080                      |
| `pnpm build:viewer`                  | Production build → `dist/`                        |
| `pnpm -F @hooksgraph/viewer preview` | Serve the built bundle locally                    |
| `pnpm test:js`                       | Vitest (viewer specs are colocated as `*.test.js`) |

## Tech

- React 18, Vite 8
- [Sigma 3](https://www.sigmajs.org/) WebGL renderer + [graphology](https://graphology.github.io/)
- Louvain community detection + ForceAtlas2 + noverlap (graphology layout libs)
- `@wordpress/components` / `@wordpress/dataviews` / `@wordpress/ui` for chrome

## More

- Architecture, layout strategy, Sigma renderer gotchas: [`CLAUDE.md`](./CLAUDE.md).
- Repo overview and monorepo commands: [`../../README.md`](../../README.md), [`../../AGENTS.md`](../../AGENTS.md).
