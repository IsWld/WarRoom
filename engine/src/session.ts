/**
 * A running game: state + command log. Pure and synchronous; the client runs it inside a
 * Web Worker and decides how many ticks to advance per frame.
 *
 * Commands take effect immediately at the current tick (even while paused) and are logged
 * with that tick. This is equivalent to passing them to the next step(), because step()
 * applies its commands before running systems, so replays reproduce the game exactly.
 */
import type { Command } from './commands.ts';
import { createLog, record, type CommandLog } from './replay.ts';
import { createSave, type SaveFile, type SaveMeta } from './save.ts';
import { applyCommands, step, SYSTEMS, type RejectedCommand, type System } from './sim.ts';
import type { GameState } from './state.ts';

export interface CommandResult {
  rejected: RejectedCommand[];
  /** True if any province owner or controller changed. */
  provincesChanged: boolean;
}

export interface AdvanceResult {
  /** Tick after advancing. */
  tick: number;
  provincesChanged: boolean;
}

export class GameSession {
  readonly state: GameState;
  readonly seed: number;
  readonly log: CommandLog;
  private readonly systems: readonly System[];

  constructor(
    state: GameState,
    seed: number,
    log: CommandLog = createLog(),
    systems: readonly System[] = SYSTEMS,
  ) {
    this.state = state;
    this.seed = seed;
    this.log = log;
    this.systems = systems;
  }

  /** Applies commands now (at the current tick) and records the accepted ones. */
  execute(commands: readonly Command[]): CommandResult {
    const before = this.provinceFingerprint();
    const rejected = applyCommands(this.state, commands);
    const accepted = commands.filter((c) => !rejected.some((r) => r.command === c));
    record(this.log, this.state.tick, accepted);
    return { rejected, provincesChanged: before !== this.provinceFingerprint() };
  }

  /** Advances `ticks` game hours. */
  advance(ticks: number): AdvanceResult {
    const before = this.provinceFingerprint();
    for (let i = 0; i < ticks; i++) step(this.state, [], this.systems);
    return { tick: this.state.tick, provincesChanged: before !== this.provinceFingerprint() };
  }

  save(meta: SaveMeta): SaveFile {
    return createSave(this.state, this.log, this.seed, meta);
  }

  /** Cheap change detector for province ownership and control. */
  private provinceFingerprint(): number {
    let h = 0x811c9dc5;
    const { owner, controller, count } = this.state.provinces;
    for (let i = 0; i < count; i++) {
      h = Math.imul(h ^ owner[i]!, 0x01000193);
      h = Math.imul(h ^ controller[i]!, 0x01000193);
    }
    return h >>> 0;
  }
}
