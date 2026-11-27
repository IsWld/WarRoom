/**
 * Equirectangular projection with a standard parallel, as described in
 * docs/design/map-format.md. Used by the map generator, labels and later by gameplay that
 * needs real distances.
 */
import type { MapDefines } from '../content/schemas.ts';

export interface Projection {
  /** Pixels per degree of latitude. */
  scale: number;
  /** Pixels per degree of longitude (scale × cos(standard parallel)). */
  scaleX: number;
  latMin: number;
  toPixel(lon: number, lat: number): [number, number];
  toLonLat(x: number, y: number): [number, number];
}

export function makeProjection(
  map: Pick<
    MapDefines,
    'width' | 'height' | 'standard_parallel' | 'lon_min' | 'lon_max' | 'lat_max'
  >,
): Projection {
  const cos = Math.cos((map.standard_parallel * Math.PI) / 180);
  const scale = map.width / ((map.lon_max - map.lon_min) * cos);
  const scaleX = scale * cos;
  const latMin = map.lat_max - map.height / scale;
  return {
    scale,
    scaleX,
    latMin,
    toPixel: (lon, lat) => [(lon - map.lon_min) * scaleX, (map.lat_max - lat) * scale],
    toLonLat: (x, y) => [map.lon_min + x / scaleX, map.lat_max - y / scale],
  };
}
