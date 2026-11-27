/**
 * Zod schemas for every content collection. These are the single source of truth for what a
 * mod may contain; later they will also generate the modding reference automatically.
 *
 * To add a collection: define its schema here and register it in CORE_SCHEMAS.
 */
import { z } from 'zod';
import { parseDay } from '../calendar.ts';
import type { ContentSchemas, Validator } from './types.ts';

const tag = z.string().regex(/^[A-Z]{3}$/, 'must be three capital letters, e.g. "GER"');
const colorChannel = z.number().int().min(0).max(255);
const isoDay = z.string().refine((s) => {
  try {
    parseDay(s);
    return true;
  } catch {
    return false;
  }
}, 'must be a real date written YYYY-MM-DD');

export const countrySchema = z
  .object({
    id: tag,
    name: z.string().min(1),
    /** Map color as [red, green, blue], each 0–255. */
    color: z.tuple([colorChannel, colorChannel, colorChannel]),
    /** Optional adjective for UI text, e.g. "German". */
    adjective: z.string().min(1).optional(),
  })
  .strict();

export const definesSchema = z
  .object({
    game: z
      .object({
        /** Date of tick 0 for the default scenario. */
        start_date: isoDay,
        /** Seed used when the player does not choose one. */
        default_seed: z.number().int(),
      })
      .passthrough(),
  })
  .passthrough();

export type CountryDef = z.infer<typeof countrySchema>;
export type Defines = z.infer<typeof definesSchema>;

/** Wraps a Zod schema in the loader's dependency-free Validator interface. */
export function zodValidator(schema: z.ZodTypeAny): Validator {
  return (value) => {
    const result = schema.safeParse(value);
    if (result.success) return { ok: true, value: result.data };
    return {
      ok: false,
      issues: result.error.issues.map((issue) => ({
        path: issue.path.map(String).join('.'),
        message: issue.message,
      })),
    };
  };
}

export const CORE_SCHEMAS: ContentSchemas = {
  collections: {
    countries: zodValidator(countrySchema),
  },
  defines: zodValidator(definesSchema),
};
