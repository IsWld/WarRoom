import { addDivision, divisionIndex } from './divisions.ts';
import { canBuild } from './economy.ts';
import { findPath } from './pathfinding.ts';
import { atWar, NO_COUNTRY, setWar, type GameState } from './state.ts';
import type { World } from './world.ts';

/**
 * Every change to the game goes through a command. Commands are plain JSON so they can be
 * logged, saved, replayed and (later) sent over the network. Provinces are dense province
 * indices; divisions are stable division ids.
 */
export type Command =
  | { type: 'SetController'; province: number; country: string }
  | { type: 'SetOwner'; province: number; country: string }
  /** Debug: `country` takes over everything `target` owns and controls. */
  | { type: 'Annex'; country: string; target: string }
  | { type: 'DeclareWar'; country: string; target: string }
  /** Ends a war; each side gets back the provinces it owns that the other controls. */
  | { type: 'WhitePeace'; country: string; target: string }
  | { type: 'MoveDivision'; division: number; target: number }
  | { type: 'StopDivision'; division: number }
  /** Debug / scenario setup: creates a full-strength division. */
  | { type: 'SpawnDivision'; country: string; template: string; province: number }
  /** Marks a country as human-controlled (true) or AI-controlled (false). */
  | { type: 'SetHuman'; country: string; human: boolean }
  | { type: 'QueueConstruction'; country: string; state: number; building: string }
  | { type: 'CancelConstruction'; country: string; index: number }
  /** Sets line `line` (or adds a line when `line` is -1) to make `equipment` with `factories`. */
  | {
      type: 'SetProductionLine';
      country: string;
      line: number;
      equipment: string;
      factories: number;
    }
  | { type: 'RemoveProductionLine'; country: string; line: number }
  | { type: 'TrainDivision'; country: string; template: string; province: number };

export type CommandType = Command['type'];

/** Returns a reason the command is invalid in this state, or null if it is valid. */
export function validateCommand(state: GameState, command: Command, world: World): string | null {
  const country = (tag: string) => state.countryTags.indexOf(tag);
  switch (command.type) {
    case 'SetController':
    case 'SetOwner': {
      if (!isProvince(state, command.province))
        return `Province ${command.province} does not exist`;
      const index = country(command.country);
      if (index < 0) return `Unknown country "${command.country}"`;
      if (index === NO_COUNTRY && command.type === 'SetOwner') {
        return 'A province cannot be owned by nobody through SetOwner';
      }
      return null;
    }
    case 'Annex':
    case 'DeclareWar':
    case 'WhitePeace': {
      const a = country(command.country);
      const b = country(command.target);
      if (a <= NO_COUNTRY) return `Unknown country "${command.country}"`;
      if (b <= NO_COUNTRY) return `Unknown country "${command.target}"`;
      if (a === b) return 'A country cannot do that to itself';
      if (command.type === 'DeclareWar' && atWar(state, a, b)) return 'Already at war';
      if (command.type === 'WhitePeace' && !atWar(state, a, b)) return 'Not at war';
      return null;
    }
    case 'MoveDivision': {
      const i = divisionIndex(state.divisions, command.division);
      if (i < 0) return `Division ${command.division} does not exist`;
      if (!isProvince(state, command.target) || !world.isLand[command.target])
        return 'Target is not a land province';
      if (planRoute(state, world, i, command.target) === null) return 'No route to the target';
      return null;
    }
    case 'StopDivision':
      return divisionIndex(state.divisions, command.division) < 0
        ? `Division ${command.division} does not exist`
        : null;
    case 'SpawnDivision': {
      if (country(command.country) <= NO_COUNTRY) return `Unknown country "${command.country}"`;
      if (!world.templateIds.includes(command.template))
        return `Unknown template "${command.template}"`;
      if (!isProvince(state, command.province) || !world.isLand[command.province])
        return 'Not a land province';
      return null;
    }
    case 'SetHuman':
      return country(command.country) <= NO_COUNTRY ? `Unknown country "${command.country}"` : null;
    case 'QueueConstruction': {
      const c = country(command.country);
      if (c <= NO_COUNTRY) return `Unknown country "${command.country}"`;
      return canBuild(state, world, c, command.state, world.buildingIds.indexOf(command.building));
    }
    case 'CancelConstruction':
    case 'RemoveProductionLine': {
      const c = country(command.country);
      if (c <= NO_COUNTRY) return `Unknown country "${command.country}"`;
      const list =
        command.type === 'CancelConstruction'
          ? state.economy[c]!.construction
          : state.economy[c]!.lines;
      const index = command.type === 'CancelConstruction' ? command.index : command.line;
      return Number.isInteger(index) && index >= 0 && index < list.length ? null : 'No such entry';
    }
    case 'SetProductionLine': {
      const c = country(command.country);
      if (c <= NO_COUNTRY) return `Unknown country "${command.country}"`;
      if (!world.equipmentIds.includes(command.equipment))
        return `Unknown equipment "${command.equipment}"`;
      if (
        !Number.isInteger(command.factories) ||
        command.factories < 0 ||
        command.factories > 1000
      ) {
        return 'Factories must be a whole number from 0 to 1000';
      }
      const lines = state.economy[c]!.lines;
      if (
        command.line !== -1 &&
        !(Number.isInteger(command.line) && command.line >= 0 && command.line < lines.length)
      ) {
        return 'No such production line';
      }
      return null;
    }
    case 'TrainDivision': {
      const c = country(command.country);
      if (c <= NO_COUNTRY) return `Unknown country "${command.country}"`;
      if (!world.templateIds.includes(command.template))
        return `Unknown template "${command.template}"`;
      if (
        !isProvince(state, command.province) ||
        state.provinces.controller[command.province] !== c
      ) {
        return 'Divisions must train in a province you control';
      }
      return null;
    }
    default:
      return `Unknown command type "${(command as { type: unknown }).type}"`;
  }
}

/** Applies a command that has already passed validateCommand. */
export function applyCommand(state: GameState, command: Command, world: World): void {
  const country = (tag: string) => state.countryTags.indexOf(tag);
  const { owner, controller, count } = state.provinces;
  switch (command.type) {
    case 'SetController':
      controller[command.province] = country(command.country);
      return;
    case 'SetOwner': {
      const index = country(command.country);
      owner[command.province] = index;
      controller[command.province] = index;
      return;
    }
    case 'Annex': {
      const a = country(command.country);
      const b = country(command.target);
      for (let i = 0; i < count; i++) {
        if (owner[i] === b) owner[i] = a;
        if (controller[i] === b) controller[i] = a;
      }
      const d = state.divisions;
      for (let i = 0; i < d.count; i++) if (d.owner[i] === b) d.owner[i] = a;
      // The annexed country's wars end; its enemies are not automatically at war with `a`.
      for (let c = 0; c < state.countryTags.length; c++) setWar(state, b, c, false);
      return;
    }
    case 'DeclareWar':
      setWar(state, country(command.country), country(command.target), true);
      return;
    case 'WhitePeace': {
      const a = country(command.country);
      const b = country(command.target);
      setWar(state, a, b, false);
      for (let i = 0; i < count; i++) {
        if ((owner[i] === a && controller[i] === b) || (owner[i] === b && controller[i] === a)) {
          controller[i] = owner[i]!;
        }
      }
      return;
    }
    case 'MoveDivision': {
      const d = state.divisions;
      const i = divisionIndex(d, command.division);
      const route = planRoute(state, world, i, command.target)!;
      const keepProgress = d.paths[i]![0] !== undefined && d.paths[i]![0] === route[0];
      d.paths[i] = route;
      if (!keepProgress) d.progress[i] = 0;
      return;
    }
    case 'StopDivision': {
      const d = state.divisions;
      const i = divisionIndex(d, command.division);
      d.paths[i] = [];
      d.progress[i] = 0;
      return;
    }
    case 'SpawnDivision': {
      const t = world.templateIds.indexOf(command.template);
      const stats = world.templates[t]!;
      addDivision(state.divisions, {
        owner: country(command.country),
        template: t,
        location: command.province,
        strength: stats.hp,
        organization: stats.organization,
      });
      return;
    }
    case 'SetHuman':
      state.humans[country(command.country)] = command.human ? 1 : 0;
      return;
    case 'QueueConstruction':
      state.economy[country(command.country)]!.construction.push({
        state: command.state,
        building: world.buildingIds.indexOf(command.building),
        progress: 0,
      });
      return;
    case 'CancelConstruction':
      state.economy[country(command.country)]!.construction.splice(command.index, 1);
      return;
    case 'SetProductionLine': {
      const lines = state.economy[country(command.country)]!.lines;
      const equipment = world.equipmentIds.indexOf(command.equipment);
      if (command.line === -1) {
        lines.push({
          equipment,
          factories: command.factories,
          efficiency: world.economy.efficiencyStart,
          progress: 0,
        });
      } else {
        const line = lines[command.line]!;
        if (line.equipment !== equipment) {
          line.equipment = equipment;
          line.efficiency = world.economy.efficiencyStart;
          line.progress = 0;
        }
        line.factories = command.factories;
      }
      return;
    }
    case 'RemoveProductionLine':
      state.economy[country(command.country)]!.lines.splice(command.line, 1);
      return;
    case 'TrainDivision':
      state.economy[country(command.country)]!.training.push({
        template: world.templateIds.indexOf(command.template),
        province: command.province,
        daysLeft: -1,
      });
      return;
  }
}

/** Whether a division of `owner` may enter a province: own, enemy-held, or unclaimed land. */
export function canEnter(state: GameState, owner: number, province: number): boolean {
  const c = state.provinces.controller[province]!;
  return c === owner || c === NO_COUNTRY || atWar(state, owner, c);
}

/** Route for division index `i` to `target`, or null. */
export function planRoute(
  state: GameState,
  world: World,
  i: number,
  target: number,
): number[] | null {
  const d = state.divisions;
  const owner = d.owner[i]!;
  return findPath(world, d.location[i]!, target, (p) => canEnter(state, owner, p));
}

function isProvince(state: GameState, province: number): boolean {
  return Number.isInteger(province) && province >= 0 && province < state.provinces.count;
}
