/**
 * Creates a game state from merged content, the map model and a scenario setup.
 */
import { parseDay } from './calendar.ts';
import type { CountryDef, SetupDef } from './content/schemas.ts';
import type { LoadedContent } from './content/types.ts';
import type { MapModel } from './map/model.ts';
import { applyCommands } from './sim.ts';
import { createState, type GameState } from './state.ts';
import type { World } from './world.ts';

export interface NewGameOptions {
  setupId: string;
  seed: number;
  /** Needed to place the setup's starting divisions; without it none are created. */
  world?: World;
}

export function createGameFromContent(
  content: LoadedContent,
  map: Pick<MapModel, 'provinceCount' | 'state' | 'stateIds'>,
  options: NewGameOptions,
): GameState {
  const setups = (content.collections.setups ?? []) as SetupDef[];
  const setup = setups.find((s) => s.id === options.setupId);
  if (!setup) throw new Error(`Unknown scenario setup "${options.setupId}"`);
  const countries = (content.collections.countries ?? []) as CountryDef[];

  // Province owner: the setup's owner of the province's state; water has no owner.
  const owners: (string | undefined)[] = new Array(map.provinceCount);
  const controllers: (string | undefined)[] = new Array(map.provinceCount);
  for (let i = 0; i < map.provinceCount; i++) {
    const s = map.state[i]!;
    if (s < 0) continue;
    const entry = setup.states[map.stateIds[s]!];
    if (!entry) throw new Error(`Setup "${setup.id}" has no owner for state "${map.stateIds[s]}"`);
    owners[i] = entry.owner;
    controllers[i] = entry.controller ?? entry.owner;
  }

  const world = options.world;
  const state = createState({
    seed: options.seed,
    startDay: parseDay(setup.start_date),
    countryTags: countries.map((c) => c.id),
    provinceCount: map.provinceCount,
    owners,
    stateCount: world?.stateCount ?? 0,
    buildingCount: world?.buildingIds.length ?? 0,
  });
  for (let i = 0; i < map.provinceCount; i++) {
    const tag = controllers[i];
    if (tag !== undefined) state.provinces.controller[i] = state.countryTags.indexOf(tag);
  }

  if (world) {
    // Starting buildings.
    world.stateIds.forEach((stateId, si) => {
      for (const [buildingId, level] of Object.entries(setup.states[stateId]?.buildings ?? {})) {
        const b = world.buildingIds.indexOf(buildingId);
        if (b < 0)
          throw new Error(`Setup "${setup.id}": unknown building "${buildingId}" in ${stateId}`);
        state.buildings[si * state.buildingCount + b] = Math.min(level, world.buildingMax[b]!);
      }
    });
    // Starting economies.
    for (const [tag, eco] of Object.entries(setup.countries ?? {})) {
      const c = state.countryTags.indexOf(tag);
      if (c < 0) throw new Error(`Setup "${setup.id}": unknown country "${tag}"`);
      const target = state.economy[c]!;
      target.manpower = eco.manpower;
      for (const [equipmentId, amount] of Object.entries(eco.stockpile)) {
        const q = world.equipmentIds.indexOf(equipmentId);
        if (q < 0) throw new Error(`Setup "${setup.id}": unknown equipment "${equipmentId}"`);
        target.stockpile[q] = amount;
      }
      for (const line of eco.production) {
        const q = world.equipmentIds.indexOf(line.equipment);
        if (q < 0) throw new Error(`Setup "${setup.id}": unknown equipment "${line.equipment}"`);
        target.lines.push({
          equipment: q,
          factories: line.factories,
          efficiency: world.economy.efficiencyCap,
          progress: 0,
        });
      }
    }
  }

  // Starting armies.
  if (world) {
    for (const div of setup.divisions ?? []) {
      const province = world.indexById.get(div.province);
      if (province === undefined)
        throw new Error(`Setup "${setup.id}": no province with id ${div.province}`);
      for (let k = 0; k < (div.count ?? 1); k++) {
        const rejected = applyCommands(
          state,
          [{ type: 'SpawnDivision', country: div.owner, template: div.template, province }],
          world,
        );
        if (rejected.length > 0) throw new Error(`Setup "${setup.id}": ${rejected[0]!.reason}`);
      }
    }
  }
  return state;
}
