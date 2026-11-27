/**
 * Fixed-point arithmetic: values are integers counting thousandths (1.5 is stored as 1500).
 *
 * Integer math on JavaScript numbers is exact below 2^53, so results are identical on every
 * machine. Keep inputs to `mul` below about 9e7 (90,000.000) each to stay in the exact range;
 * use plain integers for large counts such as manpower.
 */

export type Fixed = number;

export const FIXED_SCALE = 1000;
export const FIXED_ONE: Fixed = FIXED_SCALE;

/** Converts a decimal from content (e.g. 0.25 in a YAML file) to fixed-point, rounding. */
export function toFixed(value: number): Fixed {
  return Math.round(value * FIXED_SCALE);
}

/** Converts fixed-point to a float. For display only, never for game logic. */
export function fixedToFloat(value: Fixed): number {
  return value / FIXED_SCALE;
}

export function fixedMul(a: Fixed, b: Fixed): Fixed {
  return Math.trunc((a * b) / FIXED_SCALE);
}

export function fixedDiv(a: Fixed, b: Fixed): Fixed {
  if (b === 0) throw new RangeError('fixedDiv: division by zero');
  return Math.trunc((a * FIXED_SCALE) / b);
}

/** Multiplies a plain integer (e.g. manpower) by a fixed-point factor, truncating. */
export function scaleInt(n: number, factor: Fixed): number {
  return Math.trunc((n * factor) / FIXED_SCALE);
}

export function fixedClamp(value: Fixed, min: Fixed, max: Fixed): Fixed {
  return value < min ? min : value > max ? max : value;
}
