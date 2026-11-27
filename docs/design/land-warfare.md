# Land warfare (Phase 3)

**Status:** first version implemented in the engine; UI (counters, selection, orders, battle
panel) follows the map UI. All numbers live in content (`common/units.yaml`,
`common/defines.yaml`, `common/terrain.yaml`).

## Data

### Battalions (`battalions` collection, `common/units.yaml`)

| Field                        | Meaning                                                 |
| ---------------------------- | ------------------------------------------------------- |
| `soft_attack`, `hard_attack` | Attacks per hour against unarmored / armored targets    |
| `defense`                    | Enemy attacks it can block when defending               |
| `breakthrough`               | Enemy attacks it can block when attacking               |
| `organization`               | Combat readiness; a division at 0 organization retreats |
| `hp`                         | Strength points; a division at 0 strength is destroyed  |
| `speed`                      | km per hour on plains                                   |
| `width`                      | Combat width it occupies                                |
| `hardness`                   | 0–1 share of the unit that is armored                   |
| `manpower`                   | Men needed (used from Phase 4)                          |

### Division templates (`templates` collection)

```yaml
templates:
  - id: infantry_division
    name: Infantry Division
    battalions: { infantry: 9, artillery: 1 }
```

Division stats derive from battalions: attacks, defense, breakthrough and hp are sums;
organization and hardness are battalion-count-weighted averages; speed is the slowest
battalion; width is the sum.

### Starting armies (`setups[].divisions`)

```yaml
setups:
  - id: '1936'
    divisions:
      - { owner: GER, template: infantry_division, province: 123, count: 3 }
```

`province` is a province id from `provinces.csv`. Mods can add armies with
`@append: { divisions: [...] }`.

## State

Divisions are stored as parallel typed arrays: stable `id`, `owner`, `template`, `location`
(province index), `strength` and `organization` (fixed-point), movement `progress`
(fixed-point km) and a path (list of province indices). Wars are a symmetric country × country
matrix.

## Rules (each hour, in order)

1. **Commands**: `DeclareWar`, `WhitePeace`, `MoveDivision { division, target }`,
   `StopDivision`. A move computes the cheapest land path (A\*, cost = distance × terrain
   movement cost) through provinces controlled by the owner, by countries at war with the
   owner, or by nobody. Neutral territory blocks movement.
2. **Movement**: a moving division adds `speed / movement_cost(next province)` km of progress.
   When progress reaches the distance to the next province it enters it, unless enemy
   divisions are there (then it attacks and waits). Entering an enemy-controlled province
   occupies it.
3. **Combat** (`combat.ts`): one battle per province that holds enemy divisions and is being
   entered by attackers. Up to `combat.width` of each side fights (in division order).
   Attacks = soft × (1 − enemy hardness) + hard × enemy hardness, times the terrain's
   `attack_modifier` for attackers. Attacks up to the enemy's blocking value (defense for
   defenders, breakthrough for attackers) hit with `combat.blocked_hit_chance`, the rest with
   `combat.unblocked_hit_chance`. Hits become strength and organization damage, spread over
   the enemy's fighting divisions by width, with ±`combat.random_spread` noise from the
   seeded RNG.
4. **Retreat**: a division at 0 organization stops attacking. A defender at 0 organization
   retreats to an adjacent province its side controls that is not under attack; with nowhere to
   go it is destroyed. A division at 0 strength is destroyed.
5. **Recovery**: a division that is neither moving nor fighting regains
   `combat.organization_recovery` per hour, up to its maximum.

## Not yet

Supply, reinforcement from manpower and equipment, entrenchment, rivers, air support, combat
tactics, generals, battle plans and fronts. Each arrives in its phase.

## Testing

Unit tests cover stats derivation, pathfinding around neutral countries and water, movement
timing, combat outcomes (stronger side wins, terrain matters, retreat and destruction), and
determinism (replays match).
