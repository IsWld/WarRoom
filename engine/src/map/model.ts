/**
 * Builds the engine's map model from the province bitmap and the merged content.
 * See docs/design/map-format.md. Pure TypeScript, no DOM: works in workers, browsers and Node.
 */
import type { ProvinceDef, StateDef, TerrainDef } from '../content/schemas.ts';

export const KIND_LAND = 0;
export const KIND_SEA = 1;
export const KIND_LAKE = 2;

export interface MapModel {
  width: number;
  height: number;
  provinceCount: number;
  /** Dense province index for every pixel, row-major. */
  pixelProvince: Uint16Array;
  /** Dense index → province id from provinces.csv. */
  provinceIds: Int32Array;
  /** Province id → dense index. */
  indexById: Map<number, number>;
  kind: Uint8Array;
  /** Terrain index into `terrainIds`. */
  terrain: Uint8Array;
  terrainIds: string[];
  /** State index into `stateIds`, or -1 for water. */
  state: Int32Array;
  stateIds: string[];
  /** Provinces of each state as dense indices (CSR). */
  stateProvinceStart: Uint32Array;
  stateProvinceList: Uint16Array;
  /** Neighbors (CSR): province i's neighbors are adjList[adjStart[i] .. adjStart[i+1]). */
  adjStart: Uint32Array;
  adjList: Uint16Array;
  /** Shared border length with each neighbor, in pixel edges. */
  adjBorder: Uint32Array;
  pixelCount: Uint32Array;
  centroidX: Float32Array;
  centroidY: Float32Array;
  /** Bounding boxes in pixels, inclusive. */
  minX: Uint16Array;
  minY: Uint16Array;
  maxX: Uint16Array;
  maxY: Uint16Array;
}

export interface MapProblem {
  message: string;
  province?: number;
}

export interface BuildMapInput {
  width: number;
  height: number;
  /** RGBA bytes, length width × height × 4. Alpha is ignored. */
  pixels: Uint8Array | Uint8ClampedArray;
  provinces: readonly ProvinceDef[];
  states: readonly Pick<StateDef, 'id'>[];
  terrain: readonly Pick<TerrainDef, 'id'>[];
}

export const MAX_PROVINCES = 0xffff;

/** Builds the model. Returns null plus problems if the bitmap and csv disagree. */
export function buildMapModel(input: BuildMapInput): {
  model: MapModel | null;
  problems: MapProblem[];
} {
  const { width, height, pixels } = input;
  const problems: MapProblem[] = [];
  if (pixels.length !== width * height * 4) {
    return {
      model: null,
      problems: [
        { message: `Pixel buffer has ${pixels.length} bytes, expected ${width * height * 4}` },
      ],
    };
  }
  const n = input.provinces.length;
  if (n === 0) return { model: null, problems: [{ message: 'No provinces defined' }] };
  if (n > MAX_PROVINCES)
    return { model: null, problems: [{ message: `Too many provinces (${n} > ${MAX_PROVINCES})` }] };

  // Provinces in id order so dense indices are stable regardless of file order.
  const sorted = [...input.provinces].sort((a, b) => Number(a.id) - Number(b.id));
  const provinceIds = new Int32Array(n);
  const indexById = new Map<number, number>();
  const colorToIndex = new Map<number, number>();
  const kind = new Uint8Array(n);
  const terrain = new Uint8Array(n);
  const state = new Int32Array(n).fill(-1);
  const terrainIds = input.terrain.map((t) => t.id);
  const terrainIndex = new Map(terrainIds.map((id, i) => [id, i]));
  const stateIds = input.states.map((s) => s.id);
  const stateIndex = new Map(stateIds.map((id, i) => [id, i]));

  sorted.forEach((p, i) => {
    const id = Number(p.id);
    provinceIds[i] = id;
    indexById.set(id, i);
    const rgb = (p.color[0] << 16) | (p.color[1] << 8) | p.color[2];
    if (colorToIndex.has(rgb))
      problems.push({ message: `Duplicate color ${hex(rgb)}`, province: id });
    colorToIndex.set(rgb, i);
    kind[i] = p.kind === 'land' ? KIND_LAND : p.kind === 'sea' ? KIND_SEA : KIND_LAKE;
    terrain[i] = terrainIndex.get(p.terrain) ?? 0;
    if (p.state !== undefined) state[i] = stateIndex.get(p.state) ?? -1;
  });

  // Pixel → province index, plus per-province statistics.
  const total = width * height;
  const pixelProvince = new Uint16Array(total);
  const pixelCount = new Uint32Array(n);
  const sumX = new Float64Array(n);
  const sumY = new Float64Array(n);
  const minX = new Uint16Array(n).fill(0xffff);
  const minY = new Uint16Array(n).fill(0xffff);
  const maxX = new Uint16Array(n);
  const maxY = new Uint16Array(n);
  const unknownColors = new Map<number, number>();

  for (let y = 0, p = 0; y < height; y++) {
    for (let x = 0; x < width; x++, p++) {
      const o = p * 4;
      const rgb = (pixels[o]! << 16) | (pixels[o + 1]! << 8) | pixels[o + 2]!;
      const index = colorToIndex.get(rgb);
      if (index === undefined) {
        unknownColors.set(rgb, (unknownColors.get(rgb) ?? 0) + 1);
        continue;
      }
      pixelProvince[p] = index;
      pixelCount[index]! += 1;
      sumX[index]! += x;
      sumY[index]! += y;
      if (x < minX[index]!) minX[index] = x;
      if (x > maxX[index]!) maxX[index] = x;
      if (y < minY[index]!) minY[index] = y;
      if (y > maxY[index]!) maxY[index] = y;
    }
  }
  for (const [rgb, count] of [...unknownColors].slice(0, 20)) {
    problems.push({
      message: `Color ${hex(rgb)} appears on ${count} pixel(s) but is not in provinces.csv`,
    });
  }
  if (unknownColors.size > 20)
    problems.push({ message: `...and ${unknownColors.size - 20} more unknown colors` });
  for (let i = 0; i < n; i++) {
    if (pixelCount[i] === 0)
      problems.push({
        message: 'Province color does not appear in the bitmap',
        province: provinceIds[i]!,
      });
  }
  if (problems.length > 0) return { model: null, problems };

  const centroidX = new Float32Array(n);
  const centroidY = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    centroidX[i] = sumX[i]! / pixelCount[i]! + 0.5;
    centroidY[i] = sumY[i]! / pixelCount[i]! + 0.5;
  }

  const { adjStart, adjList, adjBorder } = buildAdjacency(pixelProvince, width, height, n);

  // States' province lists (dense indices), in state order then province index order.
  const stateProvinceStart = new Uint32Array(stateIds.length + 1);
  for (let i = 0; i < n; i++) if (state[i]! >= 0) stateProvinceStart[state[i]! + 1]! += 1;
  for (let s = 0; s < stateIds.length; s++) stateProvinceStart[s + 1]! += stateProvinceStart[s]!;
  const stateProvinceList = new Uint16Array(stateProvinceStart[stateIds.length]!);
  const fill = stateProvinceStart.slice(0, stateIds.length);
  for (let i = 0; i < n; i++) {
    const s = state[i]!;
    if (s >= 0) stateProvinceList[fill[s]!++] = i;
  }

  return {
    model: {
      width,
      height,
      provinceCount: n,
      pixelProvince,
      provinceIds,
      indexById,
      kind,
      terrain,
      terrainIds,
      state,
      stateIds,
      stateProvinceStart,
      stateProvinceList,
      adjStart,
      adjList,
      adjBorder,
      pixelCount,
      centroidX,
      centroidY,
      minX,
      minY,
      maxX,
      maxY,
    },
    problems,
  };
}

/** Builds 4-connected adjacency with shared border lengths, in CSR form, neighbors sorted. */
export function buildAdjacency(
  pixelProvince: Uint16Array,
  width: number,
  height: number,
  provinceCount: number,
): { adjStart: Uint32Array; adjList: Uint16Array; adjBorder: Uint32Array } {
  // Count border edges per unordered pair, keyed as a * 65536 + b with a < b.
  const pairs = new Map<number, number>();
  const add = (a: number, b: number) => {
    const k = a < b ? a * 65536 + b : b * 65536 + a;
    pairs.set(k, (pairs.get(k) ?? 0) + 1);
  };
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const here = pixelProvince[row + x]!;
      if (x + 1 < width) {
        const right = pixelProvince[row + x + 1]!;
        if (right !== here) add(here, right);
      }
      if (y + 1 < height) {
        const down = pixelProvince[row + width + x]!;
        if (down !== here) add(here, down);
      }
    }
  }
  const keys = [...pairs.keys()].sort((p, q) => p - q);
  const degree = new Uint32Array(provinceCount);
  for (const k of keys) {
    degree[Math.floor(k / 65536)]! += 1;
    degree[k % 65536]! += 1;
  }
  const adjStart = new Uint32Array(provinceCount + 1);
  for (let i = 0; i < provinceCount; i++) adjStart[i + 1] = adjStart[i]! + degree[i]!;
  const adjList = new Uint16Array(adjStart[provinceCount]!);
  const adjBorder = new Uint32Array(adjStart[provinceCount]!);
  const fill = adjStart.slice(0, provinceCount);
  for (const k of keys) {
    const a = Math.floor(k / 65536);
    const b = k % 65536;
    const len = pairs.get(k)!;
    adjList[fill[a]!] = b;
    adjBorder[fill[a]!++] = len;
    adjList[fill[b]!] = a;
    adjBorder[fill[b]!++] = len;
  }
  // Sort each province's neighbor slice by neighbor index for deterministic iteration.
  for (let i = 0; i < provinceCount; i++) {
    const s = adjStart[i]!;
    const e = adjStart[i + 1]!;
    const items = Array.from(
      { length: e - s },
      (_, j) => [adjList[s + j]!, adjBorder[s + j]!] as const,
    );
    items.sort((p, q) => p[0] - q[0]);
    items.forEach(([nb, len], j) => {
      adjList[s + j] = nb;
      adjBorder[s + j] = len;
    });
  }
  return { adjStart, adjList, adjBorder };
}

/** Neighbor indices of a province. */
export function neighbors(
  model: Pick<MapModel, 'adjStart' | 'adjList'>,
  index: number,
): Uint16Array {
  return model.adjList.subarray(model.adjStart[index]!, model.adjStart[index + 1]!);
}

/** Province index under a pixel, or -1 outside the map. */
export function provinceAt(
  model: Pick<MapModel, 'width' | 'height' | 'pixelProvince'>,
  x: number,
  y: number,
): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  if (xi < 0 || yi < 0 || xi >= model.width || yi >= model.height) return -1;
  return model.pixelProvince[yi * model.width + xi]!;
}

/** Counts connected pixel regions per province (should be 1 for every province). */
export function countRegions(
  model: Pick<MapModel, 'width' | 'height' | 'pixelProvince' | 'provinceCount'>,
): Uint32Array {
  const { width, height, pixelProvince } = model;
  const seen = new Uint8Array(width * height);
  const regions = new Uint32Array(model.provinceCount);
  const stack: number[] = [];
  for (let start = 0; start < width * height; start++) {
    if (seen[start]) continue;
    const id = pixelProvince[start]!;
    regions[id]! += 1;
    seen[start] = 1;
    stack.push(start);
    while (stack.length > 0) {
      const p = stack.pop()!;
      const x = p % width;
      const candidates = [x > 0 ? p - 1 : -1, x + 1 < width ? p + 1 : -1, p - width, p + width];
      for (const q of candidates) {
        if (q < 0 || q >= width * height || seen[q] || pixelProvince[q] !== id) continue;
        seen[q] = 1;
        stack.push(q);
      }
    }
  }
  return regions;
}

function hex(rgb: number): string {
  return `#${rgb.toString(16).padStart(6, '0')}`;
}
