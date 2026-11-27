/**
 * Land warfare: movement, combat, retreat and recovery, run every hour.
 * See docs/design/land-warfare.md. All arithmetic is fixed-point; iteration is in division
 * and province index order, so results are deterministic.
 */
import { canEnter } from './commands.ts';
import { removeDivisions } from './divisions.ts';
import { FIXED_ONE, fixedDiv, fixedMul, type Fixed } from './fixed.ts';
import { nextRange } from './rng.ts';
import type { System } from './sim.ts';
import { atWar, type GameState } from './state.ts';
import type { World } from './world.ts';

export const WARFARE_SYSTEMS: System[] = [{ id: 'land-warfare', everyHours: 1, run: landWarfare }];

/** Distance (fixed km) between adjacent provinces, or -1 if not adjacent. */
export function neighborDistance(world: World, from: number, to: number): Fixed {
  for (let k = world.adjStart[from]!; k < world.adjStart[from + 1]!; k++) {
    if (world.adjList[k] === to) return world.adjDistance[k]!;
  }
  return -1;
}

/** Divisions per province, rebuilt each hour. */
function occupancy(state: GameState): Map<number, number[]> {
  const d = state.divisions;
  const map = new Map<number, number[]>();
  for (let i = 0; i < d.count; i++) {
    const p = d.location[i]!;
    const list = map.get(p);
    if (list) list.push(i);
    else map.set(p, [i]);
  }
  return map;
}

function hasEnemy(
  state: GameState,
  occ: Map<number, number[]>,
  province: number,
  owner: number,
): boolean {
  const list = occ.get(province);
  if (!list) return false;
  return list.some((j) => atWar(state, owner, state.divisions.owner[j]!));
}

export function landWarfare(state: GameState, world: World): void {
  const d = state.divisions;
  if (d.count === 0 || world.provinceCount === 0) return;
  const occ = occupancy(state);
  const engaged = new Uint8Array(d.count);

  // 1. Movement.
  for (let i = 0; i < d.count; i++) {
    const path = d.paths[i]!;
    if (path.length === 0) continue;
    const owner = d.owner[i]!;
    const next = path[0]!;
    if (!canEnter(state, owner, next)) {
      // The route became blocked (e.g. a war ended): stop.
      d.paths[i] = [];
      d.progress[i] = 0;
      continue;
    }
    if (hasEnemy(state, occ, next, owner)) continue; // attacking; handled by combat
    const from = d.location[i]!;
    const distance = neighborDistance(world, from, next);
    if (distance < 0) {
      d.paths[i] = [];
      d.progress[i] = 0;
      continue;
    }
    const stats = world.templates[d.template[i]!]!;
    d.progress[i]! += fixedDiv(stats.speed, world.moveCost[next]!);
    if (d.progress[i]! >= distance) {
      // Enter the next province.
      const here = occ.get(from)!;
      here.splice(here.indexOf(i), 1);
      const there = occ.get(next);
      if (there) there.push(i);
      else occ.set(next, [i]);
      d.location[i] = next;
      d.progress[i] = 0;
      path.shift();
      const controller = state.provinces.controller[next]!;
      if (controller !== owner && atWar(state, owner, controller))
        state.provinces.controller[next] = owner;
    }
  }

  // 2. Combat: one battle per province being attacked, in province order.
  const attackersByProvince = new Map<number, number[]>();
  for (let i = 0; i < d.count; i++) {
    const next = d.paths[i]![0];
    if (next === undefined || d.organization[i]! <= 0) continue;
    if (!hasEnemy(state, occ, next, d.owner[i]!)) continue;
    const list = attackersByProvince.get(next);
    if (list) list.push(i);
    else attackersByProvince.set(next, [i]);
  }
  const battleProvinces = [...attackersByProvince.keys()].sort((a, b) => a - b);
  const defendedIn = new Int32Array(d.count).fill(-1);
  for (const province of battleProvinces) {
    const attackers0 = attackersByProvince.get(province)!;
    const defenders = (occ.get(province) ?? []).filter(
      (j) => d.organization[j]! > 0 && atWar(state, d.owner[attackers0[0]!]!, d.owner[j]!),
    );
    if (defenders.length === 0) continue;
    const attackers = attackers0.filter((i) => atWar(state, d.owner[i]!, d.owner[defenders[0]!]!));
    if (attackers.length === 0) continue;
    const a = takeWidth(world, state, attackers);
    const b = takeWidth(world, state, defenders);
    for (const i of a) engaged[i] = 1;
    for (const j of b) {
      engaged[j] = 1;
      defendedIn[j] = province;
    }
    // Both sides fire simultaneously, using pre-damage values.
    const damageToDefenders = sideDamage(
      state,
      world,
      a,
      b,
      world.attackModifier[province]!,
      'breakthrough-vs-defense',
    );
    const damageToAttackers = sideDamage(state, world, b, a, FIXED_ONE, 'defense-vs-breakthrough');
    applyDamage(state, world, b, damageToDefenders);
    applyDamage(state, world, a, damageToAttackers);
  }
  // Defenders whose battle is over this hour still count as engaged (no recovery).
  for (const province of battleProvinces) {
    for (const j of occ.get(province) ?? [])
      if (defendedIn[j] === -1 && d.organization[j]! <= 0) defendedIn[j] = province;
  }

  // 3. Retreat and destruction.
  const dead = new Uint8Array(d.count);
  for (let i = 0; i < d.count; i++) {
    if (d.strength[i]! <= 0) {
      dead[i] = 1;
      continue;
    }
    if (d.organization[i]! > 0) continue;
    const owner = d.owner[i]!;
    if (d.paths[i]!.length > 0 && engaged[i] && defendedIn[i] === -1) {
      // A broken attacker calls off its attack.
      d.paths[i] = [];
      d.progress[i] = 0;
      continue;
    }
    if (defendedIn[i] !== -1) {
      const from = d.location[i]!;
      let retreatTo = -1;
      for (let k = world.adjStart[from]!; k < world.adjStart[from + 1]!; k++) {
        const q = world.adjList[k]!;
        if (!world.isLand[q] || state.provinces.controller[q] !== owner) continue;
        if (hasEnemy(state, occ, q, owner) || attackersByProvince.has(q)) continue;
        retreatTo = q;
        break;
      }
      if (retreatTo === -1) {
        dead[i] = 1; // encircled
      } else {
        d.location[i] = retreatTo;
        d.paths[i] = [];
        d.progress[i] = 0;
      }
    }
  }

  // 4. Recovery for divisions that are neither moving nor fighting.
  for (let i = 0; i < d.count; i++) {
    if (dead[i] || engaged[i] || d.paths[i]!.length > 0) continue;
    const max = world.templates[d.template[i]!]!.organization;
    d.organization[i] = Math.min(max, d.organization[i]! + world.combat.organizationRecovery);
  }

  if (dead.some((x) => x === 1)) removeDivisions(d, (i) => dead[i] === 1);
}

/** Divisions that fit in the combat width, in the given order. */
function takeWidth(world: World, state: GameState, list: number[]): number[] {
  const d = state.divisions;
  const out: number[] = [];
  let used = 0;
  for (const i of list) {
    const w = world.templates[d.template[i]!]!.width;
    if (out.length > 0 && used + w > world.combat.width) continue;
    out.push(i);
    used += w;
  }
  return out;
}

interface Damage {
  strength: Fixed;
  organization: Fixed;
}

/** Total damage `shooters` deal to `targets` this hour. */
function sideDamage(
  state: GameState,
  world: World,
  shooters: number[],
  targets: number[],
  attackModifier: Fixed,
  mode: 'breakthrough-vs-defense' | 'defense-vs-breakthrough',
): Damage {
  const d = state.divisions;
  const stats = (i: number) => world.templates[d.template[i]!]!;
  // Average hardness of the targets, weighted by width.
  let width = 0;
  let hardnessSum = 0;
  for (const j of targets) {
    width += stats(j).width;
    hardnessSum += fixedMul(stats(j).hardness, stats(j).width);
  }
  const hardness = width > 0 ? fixedDiv(hardnessSum, width) : 0;
  let attacks = 0;
  for (const i of shooters) {
    const s = stats(i);
    // Damaged divisions fight with fewer men: scale attacks by remaining strength.
    const strengthShare = fixedDiv(d.strength[i]!, s.hp);
    const raw = fixedMul(s.softAttack, FIXED_ONE - hardness) + fixedMul(s.hardAttack, hardness);
    attacks += fixedMul(raw, strengthShare);
  }
  attacks = fixedMul(attacks, attackModifier);
  // Blocking: defenders block with defense, attackers with breakthrough.
  let blocks = 0;
  for (const j of targets)
    blocks += mode === 'breakthrough-vs-defense' ? stats(j).defense : stats(j).breakthrough;
  const blocked = Math.min(attacks, blocks);
  const unblocked = attacks - blocked;
  const c = world.combat;
  let hits = fixedMul(blocked, c.blockedHitChance) + fixedMul(unblocked, c.unblockedHitChance);
  const spread = c.randomSpread;
  hits = fixedMul(hits, FIXED_ONE + nextRange(state.rng, -spread, spread));
  return {
    strength: fixedMul(hits, c.strengthDamagePerHit),
    organization: fixedMul(hits, c.organizationDamagePerHit),
  };
}

/** Spreads damage over targets by combat width. */
function applyDamage(state: GameState, world: World, targets: number[], damage: Damage): void {
  const d = state.divisions;
  let width = 0;
  for (const j of targets) width += world.templates[d.template[j]!]!.width;
  if (width === 0) return;
  for (const j of targets) {
    const share = fixedDiv(world.templates[d.template[j]!]!.width, width);
    d.strength[j] = Math.max(0, d.strength[j]! - fixedMul(damage.strength, share));
    d.organization[j] = Math.max(0, d.organization[j]! - fixedMul(damage.organization, share));
  }
}
