/**
 * Cheapest land route between provinces (Dijkstra with a binary heap). Cost of entering a
 * province = distance × its terrain movement cost. Ties break by province index, so results
 * are deterministic.
 */
import { fixedMul } from './fixed.ts';
import type { World } from './world.ts';

/** Returns the route from `from` to `to` excluding `from`, or null if unreachable. */
export function findPath(
  world: World,
  from: number,
  to: number,
  canEnter: (province: number) => boolean,
): number[] | null {
  if (from === to) return [];
  if (!world.isLand[to] || !canEnter(to)) return null;
  const n = world.provinceCount;
  const cost = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const heap = new MinHeap();
  cost[from] = 0;
  heap.push(0, from);
  while (heap.size > 0) {
    const [c, p] = heap.pop();
    if (c > cost[p]!) continue;
    if (p === to) break;
    for (let k = world.adjStart[p]!; k < world.adjStart[p + 1]!; k++) {
      const q = world.adjList[k]!;
      if (!world.isLand[q] || !canEnter(q)) continue;
      const step = fixedMul(world.adjDistance[k]!, world.moveCost[q]!);
      const next = c + step;
      if (next < cost[q]! || (next === cost[q]! && p < prev[q]!)) {
        cost[q] = next;
        prev[q] = p;
        heap.push(next, q);
      }
    }
  }
  if (prev[to] === -1) return null;
  const path: number[] = [];
  for (let p = to; p !== from; p = prev[p]!) path.push(p);
  return path.reverse();
}

/** Binary min-heap of (cost, province), ordered by cost then province index. */
class MinHeap {
  private costs: number[] = [];
  private items: number[] = [];

  get size(): number {
    return this.items.length;
  }

  push(cost: number, item: number): void {
    this.costs.push(cost);
    this.items.push(item);
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(i, parent)) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): [number, number] {
    const top: [number, number] = [this.costs[0]!, this.items[0]!];
    const lastCost = this.costs.pop()!;
    const lastItem = this.items.pop()!;
    if (this.items.length > 0) {
      this.costs[0] = lastCost;
      this.items[0] = lastItem;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.items.length && this.less(l, m)) m = l;
        if (r < this.items.length && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }

  private less(a: number, b: number): boolean {
    return (
      this.costs[a]! < this.costs[b]! ||
      (this.costs[a] === this.costs[b] && this.items[a]! < this.items[b]!)
    );
  }

  private swap(a: number, b: number): void {
    [this.costs[a], this.costs[b]] = [this.costs[b]!, this.costs[a]!];
    [this.items[a], this.items[b]] = [this.items[b]!, this.items[a]!];
  }
}
