import { HOURS_PER_DAY } from './calendar.ts';
import { applyCommand, validateCommand, type Command } from './commands.ts';
import type { GameState } from './state.ts';

/** A system runs on a schedule and may read and change the state. */
export interface System {
  id: string;
  /** Runs every `everyHours` ticks (1 = hourly, 24 = daily). */
  everyHours: number;
  run(state: GameState): void;
}

export interface RejectedCommand {
  command: Command;
  reason: string;
}

export interface StepResult {
  rejected: RejectedCommand[];
}

/**
 * Systems run in this order every tick they are due. Phase 0 has none; later phases add
 * movement, combat, production, research and so on. Order matters for determinism.
 */
export const SYSTEMS: readonly System[] = [];

/**
 * Advances the simulation by one tick (one game hour):
 * 1. apply this tick's commands in order (invalid ones are rejected and change nothing),
 * 2. run every system that is due,
 * 3. increment the tick.
 */
export function step(
  state: GameState,
  commands: readonly Command[] = [],
  systems: readonly System[] = SYSTEMS,
): StepResult {
  const rejected: RejectedCommand[] = [];
  for (const command of commands) {
    const reason = validateCommand(state, command);
    if (reason === null) applyCommand(state, command);
    else rejected.push({ command, reason });
  }
  for (const system of systems) {
    if (state.tick % system.everyHours === 0) system.run(state);
  }
  state.tick += 1;
  return { rejected };
}

/** Runs `days` whole game days with no commands. */
export function advanceDays(
  state: GameState,
  days: number,
  systems: readonly System[] = SYSTEMS,
): void {
  for (let i = 0; i < days * HOURS_PER_DAY; i++) step(state, [], systems);
}
