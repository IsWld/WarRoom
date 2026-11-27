/**
 * Command log and replay. Every accepted batch of commands is recorded with the tick it was
 * applied on. Replaying the log from the same initial state reproduces the game exactly,
 * which is the basis for save verification, bug reports and lockstep multiplayer.
 */
import type { Command } from './commands.ts';
import { step, SYSTEMS, type System } from './sim.ts';
import type { GameState } from './state.ts';

export interface LogEntry {
  tick: number;
  commands: Command[];
}

export interface CommandLog {
  entries: LogEntry[];
}

export function createLog(): CommandLog {
  return { entries: [] };
}

/** Records commands for a tick. Entries must be appended in tick order. */
export function record(log: CommandLog, tick: number, commands: readonly Command[]): void {
  if (commands.length === 0) return;
  const last = log.entries.at(-1);
  if (last && last.tick > tick) throw new Error(`Log is append-only: tick ${tick} < ${last.tick}`);
  if (last && last.tick === tick) last.commands.push(...commands);
  else log.entries.push({ tick, commands: [...commands] });
}

/**
 * Advances `state` to `untilTick`, applying logged commands on their ticks. Commands logged
 * for ticks already in the past are ignored. Returns the number of rejected commands
 * (a non-zero value means the log does not match this state).
 */
export function replay(
  state: GameState,
  log: CommandLog,
  untilTick: number,
  systems: readonly System[] = SYSTEMS,
): number {
  let rejected = 0;
  let i = 0;
  while (i < log.entries.length && log.entries[i]!.tick < state.tick) i++;
  while (state.tick < untilTick) {
    const entry = log.entries[i];
    const commands = entry && entry.tick === state.tick ? entry.commands : [];
    if (commands.length > 0) i++;
    rejected += step(state, commands, systems).rejected.length;
  }
  return rejected;
}
