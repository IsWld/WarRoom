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

const slug = z.string().regex(/^[a-z0-9_]+$/, 'must be a lowercase slug: a-z, 0-9 and _');
const rgb = z.tuple([colorChannel, colorChannel, colorChannel]);
const positiveIntString = z.string().regex(/^[1-9][0-9]*$/, 'must be a positive whole number');

/** One row of map/provinces.csv. CSV values arrive as strings and are converted here. */
export const provinceSchema = z
  .object({
    id: positiveIntString,
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, 'must be a color written #rrggbb')
      .transform((hex): [number, number, number] => [
        parseInt(hex.slice(1, 3), 16),
        parseInt(hex.slice(3, 5), 16),
        parseInt(hex.slice(5, 7), 16),
      ]),
    kind: z.enum(['land', 'sea', 'lake']),
    terrain: slug,
    state: z
      .string()
      .optional()
      .transform((v) => (v === undefined || v === '' ? undefined : v))
      .pipe(slug.optional()),
  })
  .strict();

export const stateSchema = z
  .object({
    id: slug,
    name: z.string().min(1),
    provinces: z.array(z.number().int().positive()).min(1),
    manpower: z.number().int().nonnegative().optional(),
    /** Province id → victory points. */
    victory_points: z
      .record(z.string().regex(/^[1-9][0-9]*$/), z.number().int().positive())
      .optional(),
  })
  .strict();

export const terrainSchema = z
  .object({
    id: slug,
    name: z.string().min(1),
    color: rgb,
    movement_cost: z.number().positive(),
    /** Multiplies attackers' attacks into this terrain (1 = no effect). */
    attack_modifier: z.number().positive().default(1),
    water: z.boolean(),
  })
  .strict();

const nonNegative = z.number().nonnegative();

/** A battalion type; divisions are built from these. See docs/design/land-warfare.md. */
export const battalionSchema = z
  .object({
    id: slug,
    name: z.string().min(1),
    soft_attack: nonNegative,
    hard_attack: nonNegative,
    defense: nonNegative,
    breakthrough: nonNegative,
    organization: nonNegative,
    hp: z.number().positive(),
    speed: z.number().positive(),
    width: z.number().positive(),
    hardness: z.number().min(0).max(1),
    manpower: z.number().int().nonnegative(),
  })
  .strict();

export const templateSchema = z
  .object({
    id: slug,
    name: z.string().min(1),
    battalions: z.record(slug, z.number().int().positive()),
  })
  .strict();

export const setupDivisionSchema = z
  .object({
    owner: tag,
    template: slug,
    /** Province id from provinces.csv. */
    province: z.number().int().positive(),
    count: z.number().int().positive().default(1),
  })
  .strict();

export const setupStateSchema = z
  .object({
    owner: tag,
    controller: tag.optional(),
    cores: z.array(tag).default([]),
  })
  .strict();

/** A scenario start position, e.g. 1936. States are keyed by state id. */
export const setupSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    start_date: isoDay,
    states: z.record(slug, setupStateSchema),
    divisions: z.array(setupDivisionSchema).default([]),
  })
  .strict();

export const mapDefinesSchema = z
  .object({
    image: z.string().min(1),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    projection: z.literal('equirectangular'),
    standard_parallel: z.number().min(-89).max(89),
    lon_min: z.number().min(-180).max(180),
    lon_max: z.number().min(-180).max(180),
    lat_max: z.number().min(-90).max(90),
  })
  .strict()
  .refine((m) => m.lon_max > m.lon_min, 'lon_max must be greater than lon_min');

const ratio = z.number().min(0).max(1);

export const combatDefinesSchema = z
  .object({
    width: z.number().positive(),
    blocked_hit_chance: ratio,
    unblocked_hit_chance: ratio,
    strength_damage_per_hit: nonNegative,
    organization_damage_per_hit: nonNegative,
    random_spread: ratio,
    organization_recovery: nonNegative,
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
        /** Game hours simulated per real second at speeds 1–5. */
        speeds: z.array(z.number().positive()).length(5).default([2, 6, 24, 72, 240]),
      })
      .passthrough(),
    /** Map image and projection. Optional until a mod provides a map. */
    map: mapDefinesSchema.optional(),
    combat: combatDefinesSchema.optional(),
  })
  .passthrough();

export type CountryDef = z.infer<typeof countrySchema>;
export type ProvinceDef = z.output<typeof provinceSchema>;
export type StateDef = z.infer<typeof stateSchema>;
export type TerrainDef = z.infer<typeof terrainSchema>;
export type SetupDef = z.output<typeof setupSchema>;
export type MapDefines = z.infer<typeof mapDefinesSchema>;
export type BattalionDef = z.infer<typeof battalionSchema>;
export type TemplateDef = z.infer<typeof templateSchema>;
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
    provinces: zodValidator(provinceSchema),
    states: zodValidator(stateSchema),
    terrain: zodValidator(terrainSchema),
    setups: zodValidator(setupSchema),
    battalions: zodValidator(battalionSchema),
    templates: zodValidator(templateSchema),
  },
  defines: zodValidator(definesSchema),
};
