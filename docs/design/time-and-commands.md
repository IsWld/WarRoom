# Time and commands

**Status:** implemented in the engine (Phase 0–2); client UI for speeds, saves and the console is wired up with the map UI.

## Goal

A single deterministic clock and a single way to change the game, so saves, replays and
future multiplayer all work from the same mechanism.

## Rules

- One tick is one game hour. The scenario's start date maps to tick 0 (1936-01-01 00:00 for
  the first scenario; set in `defines.yaml`).
- `step(state, commands)` applies the commands queued for the current tick, in the order
  given, then runs the hourly systems, then (every 24 ticks) the daily systems, then increments
  the tick.
- Commands are plain JSON objects with a `type` field. Each has a validator; invalid commands
  are rejected with a reason and change nothing.
- All randomness comes from the state's RNG, so the same state plus the same commands always
  produce the same next state.

## Phase 0 commands

| Command         | Fields                | Effect                                            |
| --------------- | --------------------- | ------------------------------------------------- |
| `SetController` | `province`, `country` | Debug: hand a province's control to a country     |
| `SetOwner`      | `province`, `country` | Debug: change a province's owner (and controller) |

## Testing

- Unit tests for each command's validation and effect.
- Determinism tests: identical runs match; save/reload mid-run matches; golden hash is stable.

## Phase 2 additions

| Piece                  | Where                             | Notes                                                                                                                                                                   |
| ---------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scenario start         | `engine/src/scenario.ts`          | `createGameFromContent(content, map, {setupId, seed})` sets owners and controllers from a `setups` record.                                                              |
| `Annex` command        | `engine/src/commands.ts`          | Debug: one country takes everything another owns and controls.                                                                                                          |
| Immediate commands     | `GameSession.execute`             | Commands apply at the current tick, even while paused, and are logged with that tick. Equivalent to the next `step()` because `step()` applies commands before systems. |
| Command log and replay | `engine/src/replay.ts`            | `replay(initialState, log, untilTick)` reproduces a game; tests check the hash matches.                                                                                 |
| Save format            | `engine/src/save.ts`              | JSON: format/version, metadata (mods, content hash, player tag), seed, snapshot, log. Loading with different content gives a warning, not a failure.                    |
| Debug console          | `engine/src/console.ts`           | `tag`, `annex`, `owner`, `control`, `speed`, `help`.                                                                                                                    |
| Simulation worker      | `client/src/sim/engine.worker.ts` | Owns the `GameSession`; advances `defines.game.speeds[speed-1]` game hours per real second, at most 240 ticks per 50 ms frame.                                          |
| Worker handle          | `client/src/sim/sim-client.ts`    | Promise-based `execute`, `save`, `setSpeed`; `onUpdate` receives the tick and changed province arrays.                                                                  |
| Save storage           | `client/src/sim/saves.ts`         | IndexedDB (gzip), export/import `.warroom` files.                                                                                                                       |

### Speeds

`defines.game.speeds` lists game hours per real second for speeds 1–5 (default
`[2, 6, 24, 72, 240]`). Speed 0 is paused. Space toggles pause in the UI.
