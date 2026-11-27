/**
 * Messages between the main thread and the simulation worker. Everything here must be
 * structured-cloneable. See docs/design/time-and-commands.md.
 */
import type { Command } from '../../../engine/src/commands.ts';
import type { CommandLog } from '../../../engine/src/replay.ts';
import type { SaveMeta } from '../../../engine/src/save.ts';
import type { RejectedCommand } from '../../../engine/src/sim.ts';
import type { Snapshot } from '../../../engine/src/snapshot.ts';

export type ToWorker =
  | { type: 'init'; snapshot: Snapshot; seed: number; log?: CommandLog; speeds: number[] }
  | { type: 'execute'; id: number; commands: Command[] }
  | { type: 'speed'; speed: number }
  | { type: 'save'; id: number; meta: SaveMeta };

export type FromWorker =
  | { type: 'ready'; tick: number; owner: Uint16Array; controller: Uint16Array }
  | {
      type: 'update';
      tick: number;
      /** Present only when province ownership or control changed. */
      owner?: Uint16Array;
      controller?: Uint16Array;
      /** Measured simulation time of this batch, for the performance overlay. */
      simMs: number;
      ticksRun: number;
    }
  | { type: 'executed'; id: number; rejected: RejectedCommand[] }
  | { type: 'saved'; id: number; text: string }
  | { type: 'error'; message: string };
