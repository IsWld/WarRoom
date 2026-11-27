/**
 * Phase 4 economy: industry, construction, production, manpower, training, reinforcement and
 * supply. See docs/design/economy.md. Fixed-point throughout; countries and lists are
 * processed in index order.
 */
import { addDivision } from './divisions.ts';
import { FIXED_ONE, fixedDiv, fixedMul, type Fixed } from './fixed.ts';
import type { System } from './sim.ts';
import { NO_COUNTRY, type GameState } from './state.ts';
import type { World } from './world.ts';

export const ECONOMY_SYSTEMS: System[] = [
  { id: 'economy', everyHours: 24, run: dailyEconomy },
  { id: 'supply', everyHours: 1, run: supplyAttrition },
];

export function buildingLevel(state: GameState, s: number, b: number): number {
  return b < 0 ? 0 : state.buildings[s * state.buildingCount + b]!;
}

/** States a country owns and controls (all of their land provinces). */
export function isCoreHeld(state: GameState, world: World, s: number, country: number): boolean {
  for (let k = world.stateProvinceStart[s]!; k < world.stateProvinceStart[s + 1]!; k++) {
    const p = world.stateProvinceList[k]!;
    if (state.provinces.owner[p] !== country || state.provinces.controller[p] !== country)
      return false;
  }
  return world.stateProvinceStart[s + 1]! > world.stateProvinceStart[s]!;
}

/** Controller of a state: the country controlling most of its provinces (first in order on ties). */
export function stateController(state: GameState, world: World, s: number): number {
  const counts = new Map<number, number>();
  let best = NO_COUNTRY;
  let bestCount = 0;
  for (let k = world.stateProvinceStart[s]!; k < world.stateProvinceStart[s + 1]!; k++) {
    const c = state.provinces.controller[world.stateProvinceList[k]!]!;
    const n = (counts.get(c) ?? 0) + 1;
    counts.set(c, n);
    if (n > bestCount || (n === bestCount && c < best)) {
      best = c;
      bestCount = n;
    }
  }
  return best;
}

export interface IndustrySummary {
  civilian: number;
  military: number;
  consumerGoods: number;
  /** Civilian factories spent importing resources. */
  trade: number;
  construction: number;
  /** Fixed-point resources available per day, by resource index. */
  resources: number[];
  /** Fixed-point resources needed per day, by resource index. */
  needed: number[];
  /** Fixed-point share (0–1) of each resource's need that is met after trade. */
  resourceShare: number[];
}

/** Industry, resources and trade for one country (no state changes). */
export function industry(state: GameState, world: World, country: number): IndustrySummary {
  const R = world.resourceIds.length;
  let civilian = 0;
  let military = 0;
  const resources = new Array<number>(R).fill(0);
  for (let s = 0; s < world.stateCount; s++) {
    if (isCoreHeld(state, world, s, country)) {
      civilian += buildingLevel(state, s, world.civilianFactory);
      military += buildingLevel(state, s, world.militaryFactory);
    }
    if (stateController(state, world, s) === country) {
      for (let r = 0; r < R; r++) resources[r]! += world.stateResources[s * R + r]!;
    }
  }
  const e = world.economy;
  const consumerGoods = Math.min(civilian, Math.ceil((civilian * e.consumerGoods) / FIXED_ONE));
  const needed = new Array<number>(R).fill(0);
  // Resources are needed only for factories that actually work (lines beyond the country's
  // military factories are idle).
  let working = military;
  for (const line of state.economy[country]!.lines) {
    const factories = Math.min(line.factories, working);
    working -= factories;
    for (let r = 0; r < R; r++)
      needed[r]! += world.equipmentResources[line.equipment * R + r]! * factories;
  }
  // Import deficits with civilian factories, in resource order, while factories remain.
  let free = civilian - consumerGoods;
  let trade = 0;
  const resourceShare = new Array<number>(R).fill(FIXED_ONE);
  for (let r = 0; r < R; r++) {
    let deficit = needed[r]! - resources[r]!;
    if (deficit <= 0) continue;
    const factoriesNeeded = Math.ceil(deficit / e.resourcesPerTradeFactory);
    const used = Math.min(free, factoriesNeeded);
    free -= used;
    trade += used;
    deficit -= used * e.resourcesPerTradeFactory;
    if (deficit > 0) resourceShare[r] = fixedDiv(needed[r]! - deficit, needed[r]!);
  }
  return {
    civilian,
    military,
    consumerGoods,
    trade,
    construction: free,
    resources,
    needed,
    resourceShare,
  };
}

/** Whether `country` can queue one more level of `building` in state `s`. */
export function canBuild(
  state: GameState,
  world: World,
  country: number,
  s: number,
  b: number,
): string | null {
  if (s < 0 || s >= world.stateCount) return 'No such state';
  if (b < 0 || b >= world.buildingIds.length) return 'No such building';
  if (!isCoreHeld(state, world, s, country)) return 'You must own and control the whole state';
  const queued = state.economy[country]!.construction.filter((c) => c.state === s);
  if (world.buildingShared[b]) {
    let used = 0;
    for (let k = 0; k < world.buildingIds.length; k++)
      if (world.buildingShared[k]) used += buildingLevel(state, s, k);
    used += queued.filter((c) => world.buildingShared[c.building]).length;
    if (used >= world.stateSlots[s]!) return 'No free building slots';
  } else {
    const level = buildingLevel(state, s, b) + queued.filter((c) => c.building === b).length;
    if (level >= world.buildingMax[b]!) return 'Already at the maximum level';
  }
  return null;
}

function dailyEconomy(state: GameState, world: World): void {
  if (world.stateCount === 0) return;
  const e = world.economy;
  const E = world.equipmentIds.length;
  for (let c = 1; c < state.countryTags.length; c++) {
    const eco = state.economy[c]!;
    const ind = industry(state, world, c);

    // Construction.
    let civs = ind.construction;
    const finished: number[] = [];
    for (let k = 0; k < eco.construction.length && civs > 0; k++) {
      const project = eco.construction[k]!;
      const factories = Math.min(civs, e.maxFactoriesPerProject);
      civs -= factories;
      project.progress += factories * e.constructionPerFactory;
      if (project.progress >= world.buildingCost[project.building]!) {
        if (isCoreHeld(state, world, project.state, c)) {
          state.buildings[project.state * state.buildingCount + project.building]! += 1;
        }
        finished.push(k);
      }
    }
    for (const k of finished.reverse()) eco.construction.splice(k, 1);

    // Production: lines may not use more military factories than the country has.
    let factoriesLeft = ind.military;
    for (const line of eco.lines) {
      const factories = Math.min(line.factories, factoriesLeft);
      factoriesLeft -= factories;
      let share: Fixed = FIXED_ONE;
      for (let r = 0; r < world.resourceIds.length; r++) {
        if (world.equipmentResources[line.equipment * world.resourceIds.length + r]! > 0) {
          share = Math.min(share, ind.resourceShare[r]!);
        }
      }
      const output = fixedMul(fixedMul(factories * e.outputPerFactory, line.efficiency), share);
      line.progress += output;
      const cost = world.equipmentCost[line.equipment]!;
      if (cost > 0 && line.progress >= cost) {
        const units = Math.floor(line.progress / cost);
        line.progress -= units * cost;
        eco.stockpile[line.equipment] = (eco.stockpile[line.equipment] ?? 0) + units;
      }
      if (factories > 0)
        line.efficiency = Math.min(e.efficiencyCap, line.efficiency + e.efficiencyGrowth);
    }

    // Manpower growth from controlled states.
    let base = 0;
    for (let s = 0; s < world.stateCount; s++) {
      if (stateController(state, world, s) === c) base += world.stateManpower[s]!;
    }
    eco.manpower += Math.floor((base * e.recruitableShare) / FIXED_ONE / 365);

    // Training.
    for (let k = 0; k < eco.training.length; k++) {
      const t = eco.training[k]!;
      if (t.daysLeft < 0) {
        const stats = world.templates[t.template]!;
        let ok = eco.manpower >= stats.manpower;
        for (let q = 0; q < E && ok; q++) {
          if ((eco.stockpile[q] ?? 0) < world.templateEquipment[t.template * E + q]!) ok = false;
        }
        if (!ok) continue;
        eco.manpower -= stats.manpower;
        for (let q = 0; q < E; q++)
          eco.stockpile[q] = (eco.stockpile[q] ?? 0) - world.templateEquipment[t.template * E + q]!;
        t.daysLeft = e.trainingDays;
      }
      t.daysLeft -= 1;
    }
    const deployed: number[] = [];
    eco.training.forEach((t, k) => {
      if (t.daysLeft !== 0) return;
      const province = deployProvince(state, world, c, t.province);
      if (province < 0) {
        t.daysLeft = 1; // nowhere to deploy; retry tomorrow (becomes 0 again)
        return;
      }
      const stats = world.templates[t.template]!;
      addDivision(state.divisions, {
        owner: c,
        template: t.template,
        location: province,
        strength: stats.hp,
        organization: stats.organization,
      });
      deployed.push(k);
    });
    for (const k of deployed.reverse()) eco.training.splice(k, 1);
  }

  reinforce(state, world);
}

/** The requested province if still controlled, else the country's first controlled land province. */
function deployProvince(state: GameState, world: World, country: number, wanted: number): number {
  if (state.provinces.controller[wanted] === country) return wanted;
  for (let p = 0; p < world.provinceCount; p++) {
    if (world.isLand[p] && state.provinces.controller[p] === country) return p;
  }
  return -1;
}

/** Damaged divisions regain strength, paying manpower and equipment in proportion. */
function reinforce(state: GameState, world: World): void {
  const d = state.divisions;
  const E = world.equipmentIds.length;
  for (let i = 0; i < d.count; i++) {
    const t = d.template[i]!;
    const stats = world.templates[t]!;
    const missing = stats.hp - d.strength[i]!;
    if (missing <= 0) continue;
    const eco = state.economy[d.owner[i]!]!;
    let gain = fixedMul(missing, world.economy.reinforceRate) || missing;
    // Limit by manpower and each equipment type: cost per strength point = need / hp.
    const limit = (have: number, need: number) =>
      need <= 0 ? gain : Math.floor((have * stats.hp) / need);
    gain = Math.min(gain, limit(eco.manpower, stats.manpower));
    for (let q = 0; q < E; q++)
      gain = Math.min(gain, limit(eco.stockpile[q] ?? 0, world.templateEquipment[t * E + q]!));
    if (gain <= 0) continue;
    eco.manpower -= Math.ceil((stats.manpower * gain) / stats.hp);
    for (let q = 0; q < E; q++) {
      const need = world.templateEquipment[t * E + q]!;
      if (need > 0)
        eco.stockpile[q] = (eco.stockpile[q] ?? 0) - Math.ceil((need * gain) / stats.hp);
    }
    d.strength[i] = Math.min(stats.hp, d.strength[i]! + gain);
  }
}

/** Divisions in a state beyond its supply capacity suffer attrition every hour. */
function supplyAttrition(state: GameState, world: World): void {
  const d = state.divisions;
  if (d.count === 0 || world.stateCount === 0) return;
  const inState = new Int32Array(world.stateCount);
  for (let i = 0; i < d.count; i++) {
    const s = world.provinceState[d.location[i]!]!;
    if (s >= 0) inState[s]! += 1;
  }
  const e = world.economy;
  for (let i = 0; i < d.count; i++) {
    const s = world.provinceState[d.location[i]!]!;
    if (s < 0) continue;
    const capacity =
      e.supplyBase + buildingLevel(state, s, world.infrastructure) * e.supplyPerInfrastructure;
    const demand = inState[s]! * FIXED_ONE;
    if (demand <= capacity) continue;
    // Attrition scales with how far demand exceeds capacity.
    const excess = fixedDiv(demand - capacity, demand);
    const rate = fixedMul(e.supplyAttrition, excess);
    const stats = world.templates[d.template[i]!]!;
    d.strength[i] = Math.max(1, d.strength[i]! - fixedMul(stats.hp, rate));
    d.organization[i] = Math.max(0, d.organization[i]! - fixedMul(stats.organization, rate * 5));
  }
}
