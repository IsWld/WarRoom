/**
 * The simulation worker. Owns the GameSession and advances it in real time according to the
 * current speed. The engine itself is pure; all timing lives here.
 */
import { GameSession } from '../../../engine/src/session.ts';
import { fromSnapshot } from '../../../engine/src/snapshot.ts';
import type { FromWorker, ToWorker } from './protocol.ts';

const FRAME_MS = 50;
/** Upper bound on ticks per frame so a slow machine degrades gracefully instead of freezing. */
const MAX_TICKS_PER_FRAME = 240;

let session: GameSession | null = null;
let speeds: number[] = [2, 6, 24, 72, 240];
let speed = 0;
let carry = 0;
let lastTime = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

function post(message: FromWorker, transfer: Transferable[] = []): void {
  (self as unknown as { postMessage(m: unknown, t: Transferable[]): void }).postMessage(
    message,
    transfer,
  );
}

function provinceArrays(s: GameSession): { owner: Uint16Array; controller: Uint16Array } {
  return {
    owner: s.state.provinces.owner.slice(),
    controller: s.state.provinces.controller.slice(),
  };
}

function frame(): void {
  timer = null;
  if (!session || speed === 0) return;
  const now = performance.now();
  const elapsed = Math.min(now - lastTime, 500) / 1000;
  lastTime = now;
  carry += elapsed * speeds[speed - 1]!;
  const ticks = Math.min(Math.floor(carry), MAX_TICKS_PER_FRAME);
  carry = Math.min(carry - ticks, MAX_TICKS_PER_FRAME);
  if (ticks > 0) {
    const start = performance.now();
    const result = session.advance(ticks);
    const simMs = performance.now() - start;
    if (result.provincesChanged) {
      const arrays = provinceArrays(session);
      post({ type: 'update', tick: result.tick, ...arrays, simMs, ticksRun: ticks }, [
        arrays.owner.buffer,
        arrays.controller.buffer,
      ]);
    } else {
      post({ type: 'update', tick: result.tick, simMs, ticksRun: ticks });
    }
  }
  timer = setTimeout(frame, FRAME_MS);
}

function setSpeed(next: number): void {
  speed = Math.max(0, Math.min(5, Math.floor(next)));
  carry = 0;
  lastTime = performance.now();
  if (speed > 0 && timer === null) timer = setTimeout(frame, FRAME_MS);
}

self.onmessage = (event: MessageEvent<ToWorker>) => {
  const message = event.data;
  try {
    switch (message.type) {
      case 'init': {
        session = new GameSession(fromSnapshot(message.snapshot), message.seed, {
          ...(message.log ? { log: message.log } : {}),
          world: message.world,
        });
        speeds = message.speeds;
        setSpeed(0);
        const arrays = provinceArrays(session);
        post({ type: 'ready', tick: session.state.tick, ...arrays }, [
          arrays.owner.buffer,
          arrays.controller.buffer,
        ]);
        break;
      }
      case 'execute': {
        if (!session) throw new Error('Game not started');
        const result = session.execute(message.commands);
        post({ type: 'executed', id: message.id, rejected: result.rejected });
        if (result.provincesChanged) {
          const arrays = provinceArrays(session);
          post({ type: 'update', tick: session.state.tick, ...arrays, simMs: 0, ticksRun: 0 }, [
            arrays.owner.buffer,
            arrays.controller.buffer,
          ]);
        }
        break;
      }
      case 'speed':
        setSpeed(message.speed);
        break;
      case 'save': {
        if (!session) throw new Error('Game not started');
        post({ type: 'saved', id: message.id, text: JSON.stringify(session.save(message.meta)) });
        break;
      }
    }
  } catch (error) {
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
