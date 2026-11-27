# Economy (Phase 4)

**Status:** first version implemented in the engine. Wars are won by industry: factories turn
resources into equipment, equipment and manpower become and sustain divisions. All numbers
live in content. This is the foundation for the six-layer economy and national economic paths
described in the 1936 research doc (money, labor laws and plans come in later phases).

## Data

| Collection / field                                                   | Meaning                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `resources`                                                          | Strategic resources: `oil`, `steel`, `aluminium`, `rubber`, `tungsten`, `chromium`.                                                                                                                                                           |
| `buildings`                                                          | `civilian_factory`, `military_factory`, `dockyard` (use shared state building slots), `infrastructure` (levels 0–10, own cap), `fort`, `refinery` (adds rubber/oil later). Fields: `cost` (construction points), `max_level`, `shared_slots`. |
| `equipment`                                                          | Things factories make: `cost` (production points per unit) and `resources` needed per factory per day.                                                                                                                                        |
| `battalions[].equipment`                                             | Equipment a battalion needs at full strength, e.g. `{ infantry_equipment: 100 }`.                                                                                                                                                             |
| `states[].building_slots`, `states[].resources`, `states[].manpower` | Static state properties.                                                                                                                                                                                                                      |
| `setups[].states.<id>.buildings`                                     | Buildings at scenario start.                                                                                                                                                                                                                  |
| `setups[].countries.<TAG>`                                           | Starting `manpower`, equipment `stockpile`, `production` lines.                                                                                                                                                                               |
| `defines.economy`                                                    | Rates and shares (below).                                                                                                                                                                                                                     |

## Daily rules (in order)

1. **Industry count**: a country uses factories in states it owns _and_ controls, and
   resources from states it controls.
2. **Consumer goods**: `economy.consumer_goods` × civilian factories (rounded up) are
   unavailable.
3. **Resources and trade**: production lines need resources (equipment `resources` × assigned
   factories). Deficits are imported automatically at `economy.resources_per_trade_factory`
   resources per civilian factory, as long as civilian factories are left. Remaining shortage
   lowers the output of the lines that need that resource proportionally.
4. **Construction**: remaining civilian factories each add `economy.construction_per_factory`
   points per day to the construction queue in order, at most
   `economy.max_factories_per_project` on one project.
5. **Production**: each line produces
   `factories × economy.output_per_factory × efficiency × resource share` production points
   per day; whole units of equipment go to the stockpile. Efficiency starts at
   `economy.efficiency_start` and grows by `economy.efficiency_growth` per day up to
   `economy.efficiency_cap`. Changing what a line makes resets efficiency.
6. **Manpower**: each day adds controlled states' manpower × `economy.recruitable_share` /
   365 to the pool.
7. **Training**: queued divisions take equipment and manpower when they start, then
   `economy.training_days` to deploy at full strength.
8. **Reinforcement**: damaged divisions regain up to `economy.reinforce_rate` of their missing
   strength per day, paying manpower and equipment in proportion.
9. **Supply**: each state supports `supply.base + infrastructure × supply.per_infrastructure`
   divisions. Excess divisions lose organization and strength each hour
   (`supply.attrition`).

## Commands

`QueueConstruction {country, state, building}`, `CancelConstruction {country, index}`,
`SetProductionLine {country, line, equipment, factories}` (line −1 adds a line),
`RemoveProductionLine {country, line}`, `TrainDivision {country, template, province}`.

## Not yet

Money, inflation, debt, labor laws, economic plans and paths, real trade partners, naval
convoys, strategic bombing. See the 1936 research doc's economic system section.
