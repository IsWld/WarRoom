/**
 * Main-thread handle on the simulation worker: starts it, sends commands and speed changes,
 * and reports updates. The UI never touches game state directly.
 */
import type { Command } from '../../../engine/src/commands.ts';
import type { CommandLog } from '../../../engine/src/replay.ts';
import type { SaveMeta } from '../../../engine/src/save.ts';
import type { RejectedCommand } from '../../../engine/src/sim.ts';
import type { Snapshot } from '../../../engine/src/snapshot.ts';
import type { World } from '../../../engine/src/world.ts';
import type { FromWorker, ToWorker } from './protocol.ts';

export interface SimUpdate {
  tick: number;
  owner?: Uint16Array;
  controller?: Uint16Array;
  simMs: number;
  ticksRun: number;
}

export interface SimClientOptions {
  onUpdate(update: SimUpdate): void;
  onError?(message: string): void;
}

export class SimClient {
  private readonly worker: Worker;
  private readonly options: SimClientOptions;
  private nextId = 1;
  private readonly pending = new Map<number, (value: unknown) => void>();
  private readyResolve:
    | ((value: { tick: number; owner: Uint16Array; controller: Uint16Array }) => void)
    | null = null;
  speed = 0;
  tick = 0;

  constructor(options: SimClientOptions) {
    this.options = options;
    this.worker = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<FromWorker>) => this.receive(event.data);
    this.worker.onerror = (event) => options.onError?.(event.message || 'Simulation worker failed');
  }

  /** Starts (or restarts) the game in the worker. */
  start(
    snapshot: Snapshot,
    seed: number,
    speeds: number[],
    world: World,
    log?: CommandLog,
  ): Promise<{ tick: number; owner: Uint16Array; controller: Uint16Array }> {
    this.speed = 0;
    return new Promise((resolve) => {
      this.readyResolve = resolve;
      this.send({ type: 'init', snapshot, seed, speeds, world, ...(log ? { log } : {}) });
    });
  }

  execute(commands: Command[]): Promise<RejectedCommand[]> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, resolve as (value: unknown) => void);
      this.send({ type: 'execute', id, commands });
    });
  }

  setSpeed(speed: number): void {
    this.speed = Math.max(0, Math.min(5, speed));
    this.send({ type: 'speed', speed: this.speed });
  }

  save(meta: SaveMeta): Promise<string> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, resolve as (value: unknown) => void);
      this.send({ type: 'save', id, meta });
    });
  }

  dispose(): void {
    this.worker.terminate();
  }

  private send(message: ToWorker): void {
    this.worker.postMessage(message);
  }

  private receive(message: FromWorker): void {
    switch (message.type) {
      case 'ready':
        this.tick = message.tick;
        this.readyResolve?.({
          tick: message.tick,
          owner: message.owner,
          controller: message.controller,
        });
        this.readyResolve = null;
        break;
      case 'update':
        this.tick = message.tick;
        this.options.onUpdate(message);
        break;
      case 'executed':
        this.resolve(message.id, message.rejected);
        break;
      case 'saved':
        this.resolve(message.id, message.text);
        break;
      case 'error':
        this.options.onError?.(message.message);
        break;
    }
  }

  private resolve(id: number, value: unknown): void {
    const fn = this.pending.get(id);
    this.pending.delete(id);
    fn?.(value);
  }
}
