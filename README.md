# WarRoom

A free, moddable grand strategy game that runs in the browser. Pick a nation in a historical
world crisis (1936 first, modern day later), manage its economy, politics, research and
armies, and fight a world war in real time with pause.

> Status: **Phase 0 — Foundations.** There is no gameplay yet. See [docs/ROADMAP.md](docs/ROADMAP.md).

## Play

Every merge to `main` is published to GitHub Pages:
**https://iswld.github.io/WarRoom/** (desktop browsers only).

## Develop

Requires Node.js 22.18 or newer.

```sh
npm install
npm run dev               # local dev server
npm run check             # typecheck, lint, tests, content validation
npm test                  # engine and tools tests only
npm run validate:content  # check the core mod for errors
```

## Layout

| Folder          | What lives there                                                                        |
| --------------- | --------------------------------------------------------------------------------------- |
| `engine/`       | The deterministic simulation. Pure TypeScript, no DOM, no wall clock, no `Math.random`. |
| `client/`       | What runs in the browser: map rendering, UI, talking to the engine.                     |
| `tools/`        | Command-line tools: content validation, later the map generator.                        |
| `content/core/` | The base game, packaged as a mod called `core`.                                         |
| `docs/`         | Architecture, roadmap, design specs, modding guide.                                     |

## Modding

The base game is itself a mod, so anything it does, a mod can do too. See
[docs/MODDING.md](docs/MODDING.md).

## Credits

Data sources and their licenses are listed in [docs/CREDITS.md](docs/CREDITS.md).
