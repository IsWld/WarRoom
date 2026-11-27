/**
 * Cross-collection checks that a single record's schema cannot express: references between
 * provinces, states, terrain, countries and scenario setups. Run after loadMods.
 */
import type { CountryDef, ProvinceDef, SetupDef, StateDef, TerrainDef } from './schemas.ts';
import type { ContentError, LoadedContent } from './types.ts';

const SOURCE = 'content';

export function checkReferences(content: LoadedContent): ContentError[] {
  const errors: ContentError[] = [];
  const err = (record: string, message: string) => errors.push({ mod: SOURCE, record, message });

  const countries = (content.collections.countries ?? []) as CountryDef[];
  const provinces = (content.collections.provinces ?? []) as ProvinceDef[];
  const states = (content.collections.states ?? []) as StateDef[];
  const terrain = (content.collections.terrain ?? []) as TerrainDef[];
  const setups = (content.collections.setups ?? []) as SetupDef[];

  const countryIds = new Set(countries.map((c) => c.id));
  const terrainById = new Map(terrain.map((t) => [t.id, t]));
  const stateIds = new Set(states.map((s) => s.id));
  const provinceById = new Map(provinces.map((p) => [Number(p.id), p]));

  // Provinces: unique colors, known terrain, state only on land.
  const colorOwner = new Map<string, string>();
  for (const p of provinces) {
    const where = `provinces/${p.id}`;
    const colorKey = p.color.join(',');
    const other = colorOwner.get(colorKey);
    if (other !== undefined) err(where, `Color is already used by province ${other}`);
    else colorOwner.set(colorKey, p.id);

    const t = terrainById.get(p.terrain);
    if (!t) err(where, `Unknown terrain "${p.terrain}"`);
    else if (t.water !== (p.kind !== 'land')) {
      err(where, `Terrain "${p.terrain}" does not fit a ${p.kind} province`);
    }
    if (p.kind === 'land') {
      if (p.state === undefined) err(where, 'Land province has no state');
      else if (!stateIds.has(p.state)) err(where, `Unknown state "${p.state}"`);
    } else if (p.state !== undefined) {
      err(where, `A ${p.kind} province cannot belong to a state`);
    }
  }

  // States: provinces exist, are land, and agree with the province's own state column.
  const claimedBy = new Map<number, string>();
  for (const s of states) {
    const where = `states/${s.id}`;
    for (const id of s.provinces) {
      const p = provinceById.get(id);
      if (!p) {
        err(where, `Province ${id} does not exist`);
        continue;
      }
      if (p.kind !== 'land') err(where, `Province ${id} is ${p.kind}, not land`);
      const previous = claimedBy.get(id);
      if (previous !== undefined)
        err(where, `Province ${id} is also listed by state "${previous}"`);
      claimedBy.set(id, s.id);
      if (p.state !== undefined && p.state !== s.id) {
        err(where, `Province ${id} says it belongs to "${p.state}"`);
      }
    }
    for (const vp of Object.keys(s.victory_points ?? {})) {
      if (!s.provinces.includes(Number(vp)))
        err(where, `Victory points on province ${vp}, which is not in this state`);
    }
  }
  for (const p of provinces) {
    if (p.kind === 'land' && !claimedBy.has(Number(p.id))) {
      err(`provinces/${p.id}`, 'No state lists this province');
    }
  }

  // Setups: every state owned by a known country.
  for (const setup of setups) {
    const where = `setups/${setup.id}`;
    for (const s of states) {
      if (!(s.id in setup.states)) err(where, `State "${s.id}" has no owner`);
    }
    for (const [stateId, entry] of Object.entries(setup.states)) {
      if (!stateIds.has(stateId)) err(where, `Unknown state "${stateId}"`);
      for (const tag of [entry.owner, entry.controller, ...entry.cores]) {
        if (tag !== undefined && !countryIds.has(tag))
          err(where, `${stateId}: unknown country "${tag}"`);
      }
    }
  }

  return errors;
}
