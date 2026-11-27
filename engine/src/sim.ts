import { HOURS_PER_DAY } from './calendar.ts';
import { applyCommand, validateCommand, type Command } from './commands.ts';
import type { GameState } from './state.ts';
import { AI_SYSTEMS } from './ai.ts';
import { WARFARE_SYSTEMS } from './warfare.ts';
import { EMPTY_WORLD, type World } from './world.ts';

/** A system runs on a schedule and may read and change the state. */
export interface System {
  id: string;
  /** Runs every `everyHours` ticks (1 = hourly, 24 = daily). */
  everyHours: number;
  run(state: GameState, world: World): void;
}

export interface RejectedCommand {
  command: Command;
  reason: string;
}

export interface StepResult {
  rejected: RejectedCommand[];
}

/** Systems run in this order every tick they are due. Order matters for determinism. */
export const SYSTEMS: readonly System[] = [...AI_SYSTEMS, ...WARFARE_SYSTEMS];

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
  world: World = EMPTY_WORLD,
): StepResult {
  const rejected = applyCommands(state, commands, world);
  for (const system of systems) {
    if (state.tick % system.everyHours === 0) system.run(state, world);
  }
  state.tick += 1;
  return { rejected };
}

/**
 * Validates and applies commands at the current tick without advancing time. Equivalent to
 * passing them to the next step(): step() applies its commands before running systems.
 */
export function applyCommands(
  state: GameState,
  commands: readonly Command[],
  world: World = EMPTY_WORLD,
): RejectedCommand[] {
  const rejected: RejectedCommand[] = [];
  for (const command of commands) {
    const reason = validateCommand(state, command, world);
    if (reason === null) applyCommand(state, command, world);
    else rejected.push({ command, reason });
  }
  return rejected;
}

/** Runs `days` whole game days with no commands. */
export function advanceDays(
  state: GameState,
  days: number,
  systems: readonly System[] = SYSTEMS,
  world: World = EMPTY_WORLD,
): void {
  for (let i = 0; i < days * HOURS_PER_DAY; i++) step(state, [], systems, world);
}
