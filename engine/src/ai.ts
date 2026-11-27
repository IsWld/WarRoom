/**
 * Phase 3 AI: every few hours, each AI country at war holds its borders and attacks where it
 * has local superiority. Deliberately simple; the layered strategic/operational AI arrives in
 * Phase 7. AI decisions are a deterministic function of the state, so they are reproduced by
 * replays without being logged.
 */
import { applyCommand, canEnter, planRoute } from './commands.ts';
import { fixedDiv, fixedMul, type Fixed } from './fixed.ts';
import type { System } from './sim.ts';
import { atWar, NO_COUNTRY, type GameState } from './state.ts';
import type { World } from './world.ts';

export const AI_INTERVAL_HOURS = 6;
/** Attack only with at least this much more power than the defenders (fixed-point 1.5). */
const ATTACK_RATIO: Fixed = 1500;
/** Divisions below this share of max organization rest instead of attacking. */
const READY_ORG_SHARE: Fixed = 600;

export const AI_SYSTEMS: System[] = [{ id: 'ai', everyHours: AI_INTERVAL_HOURS, run: runAi }];

/** Combat power of a division: organization × strength share (fixed-point). */
function power(state: GameState, world: World, i: number): Fixed {
  const d = state.divisions;
  const hp = world.templates[d.template[i]!]!.hp;
  return fixedMul(d.organization[i]!, fixedDiv(d.strength[i]!, hp));
}

export function runAi(state: GameState, world: World): void {
  const d = state.divisions;
  if (d.count === 0 || world.provinceCount === 0) return;
  const countries = state.countryTags.length;

  // Divisions per province.
  const byProvince = new Map<number, number[]>();
  for (let i = 0; i < d.count; i++) {
    const list = byProvince.get(d.location[i]!);
    if (list) list.push(i);
    else byProvince.set(d.location[i]!, [i]);
  }

  for (let c = 1; c < countries; c++) {
    if (state.humans[c]) continue;
    let atWarWithAnyone = false;
    for (let e = 1; e < countries; e++) if (atWar(state, c, e)) atWarWithAnyone = true;
    if (!atWarWithAnyone) continue;

    const mine: number[] = [];
    for (let i = 0; i < d.count; i++) if (d.owner[i] === c) mine.push(i);
    if (mine.length === 0) continue;
    const idle = new Set(
      mine.filter((i) => {
        const max = world.templates[d.template[i]!]!.organization;
        return d.paths[i]!.length === 0 && d.organization[i]! * 1000 >= max * READY_ORG_SHARE;
      }),
    );

    // Front: provinces we control next to land held by an enemy.
    const front: number[] = [];
    for (let p = 0; p < world.provinceCount; p++) {
      if (!world.isLand[p] || state.provinces.controller[p] !== c) continue;
      for (let k = world.adjStart[p]!; k < world.adjStart[p + 1]!; k++) {
        const q = world.adjList[k]!;
        const qc = state.provinces.controller[q]!;
        if (world.isLand[q] && qc !== NO_COUNTRY && atWar(state, c, qc)) {
          front.push(p);
          break;
        }
      }
    }
    if (front.length === 0) continue;

    const move = (i: number, target: number) => {
      const route = planRoute(state, world, i, target);
      if (!route || route.length === 0) return false;
      applyCommand(state, { type: 'MoveDivision', division: d.id[i]!, target }, world);
      idle.delete(i);
      return true;
    };

    // 1. Attacks from each front province.
    for (const p of front) {
      const here = (byProvince.get(p) ?? []).filter((i) => idle.has(i));
      if (here.length === 0) continue;
      for (let k = world.adjStart[p]!; k < world.adjStart[p + 1]!; k++) {
        const q = world.adjList[k]!;
        const qc = state.provinces.controller[q]!;
        if (!world.isLand[q] || qc === NO_COUNTRY || !atWar(state, c, qc) || !canEnter(state, c, q))
          continue;
        const available = here.filter((i) => idle.has(i));
        // Keep one division home if the front province would otherwise be empty.
        const attackers =
          available.length > 1 ? available.slice(0, available.length - 1) : available;
        if (attackers.length === 0) break;
        const defenders = (byProvince.get(q) ?? []).filter((j) => atWar(state, c, d.owner[j]!));
        let defense = 0;
        for (const j of defenders) defense += power(state, world, j);
        // Hard terrain makes defenders effectively stronger.
        defense = fixedDiv(defense, Math.max(1, world.attackModifier[q]!));
        if (defenders.length === 0) {
          move(attackers[0]!, q); // walk into an undefended province
          continue;
        }
        let attack = 0;
        for (const i of attackers) attack += power(state, world, i);
        if (attack >= fixedMul(defense, ATTACK_RATIO)) {
          for (const i of attackers) move(i, q);
        }
      }
    }

    // 2. Send idle divisions behind the lines to the least-defended front provinces.
    const frontSet = new Set(front);
    const garrison = new Map<number, number>();
    for (const p of front)
      garrison.set(p, (byProvince.get(p) ?? []).filter((i) => d.owner[i] === c).length);
    for (const i of mine) {
      if (!idle.has(i) || frontSet.has(d.location[i]!)) continue;
      let best = -1;
      let bestCount = Infinity;
      for (const p of front) {
        const g = garrison.get(p)!;
        if (g < bestCount) {
          best = p;
          bestCount = g;
        }
      }
      if (best >= 0 && move(i, best)) garrison.set(best, bestCount + 1);
    }
  }
}
