# Architecture

WarRoom is a static web app. The simulation and the screen are separate programs: a
deterministic engine (in a Web Worker from Phase 2) and a client on the main thread that
draws the map, shows panels and sends the player's orders.

```
content/ (mods) ──load, merge, validate──▶ engine (Web Worker)
                                             command queue ─▶ step() ─▶ game state
client (main thread) ──commands──────────────▲                          │
        ▲                                                               │
        └────────────────────────── snapshots + events ◀────────────────┘
```

## Engine (`engine/src`)

| Module        | Purpose                                                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `rng.ts`      | Seeded random number generator (sfc32). Its four-word state is part of the game state, so saves resume the exact same sequence. |
| `fixed.ts`    | Fixed-point arithmetic (1 unit = 1/1000) for anything that must match across machines.                                          |
| `calendar.ts` | Converts ticks (1 tick = 1 game hour) to calendar dates with integer math.                                                      |
| `state.ts`    | `GameState`: tick, RNG state, countries, and per-province typed arrays.                                                         |
| `commands.ts` | The `Command` union and how each command changes state.                                                                         |
| `sim.ts`      | `step(state, commands)` advances one tick.                                                                                      |
| `hash.ts`     | FNV-1a hash of the full state, used by the determinism harness.                                                                 |
| `snapshot.ts` | Converts state to and from a JSON-safe snapshot (the basis of saves).                                                           |
| `content/`    | The mod loader: manifests, load order, merging, schemas, error reporting.                                                       |

### Determinism

The same seed, content and command log must always produce the same state. The harness in
`engine/test/determinism.test.ts` runs the simulation from a seed, hashes the state, and checks
that (a) reruns match, (b) save-and-reload mid-run matches an uninterrupted run, and (c) a
stored "golden" hash has not changed by accident. This is what will make replays, bug reports
and lockstep multiplayer possible later.

### Time

`step()` advances one hour. Daily systems run when `tick % 24 === 0`. The client decides how
fast to call `step()` (pause and five speeds, Phase 2).

## Content (`content/`)

Each mod is a folder with a `mod.json` manifest and YAML files. The loader:

1. resolves load order from `dependencies` and `loadAfter` (errors on missing mods and cycles),
2. parses every YAML file into collections of records keyed by `id`,
3. merges mods in order (replace, `@merge`, `@append`, `@remove`),
4. validates each record against the collection's Zod schema,
5. returns the merged content plus every error with mod, file and record.

The loader core works on in-memory files, so the same code runs in the browser (fetched or
uploaded mods) and in Node (the `validate-content` tool and tests).

## Client (`client/`)

Phase 0 is a placeholder page that loads the core mod's countries and runs the engine for one
game day to prove the pipeline works in the browser. The WebGL map renderer arrives in Phase 1.

## Decisions log

| Date       | Decision                                                                                                                                                             |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-11-27 | Tests use Node's built-in `node:test` runner with native TypeScript type stripping instead of Vitest: zero extra dependencies and the same runner locally and in CI. |
| 2026-11-27 | One root `package.json` with top-level folders instead of npm workspaces, to keep tooling simple until a package actually needs separate publishing.                 |
