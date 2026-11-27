# Time and commands

**Status:** draft (Phase 0 implements the core; Phase 2 adds speeds, the worker and saving).

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
