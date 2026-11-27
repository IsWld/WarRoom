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

  const state = createState({
    seed: options.seed,
    startDay: parseDay(setup.start_date),
    countryTags: countries.map((c) => c.id),
    provinceCount: map.provinceCount,
    owners,
  });
  for (let i = 0; i < map.provinceCount; i++) {
    const tag = controllers[i];
    if (tag !== undefined) state.provinces.controller[i] = state.countryTags.indexOf(tag);
  }

  // Starting armies.
  const world = options.world;
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
