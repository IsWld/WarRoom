# Map format

**Status:** approved for Phase 1. This is the contract between the map generator
(`tools/mapgen`), the engine (`engine/src/map`) and the renderer (`client/src/map`).

## Files (all inside a mod, normally `content/core/map/`)

| File                  | What it holds                                                                                                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `map/provinces.png`   | The province bitmap. 8-bit RGB (or RGBA with alpha 255 everywhere). Every province is a patch of one unique color. Every pixel belongs to exactly one province; there is no "empty" color. |
| `map/provinces.csv`   | One row per province: its id, color and properties (below). Loaded as the `provinces` collection.                                                                                          |
| `map/states.yaml`     | The `states` collection: groups of land provinces.                                                                                                                                         |
| `common/terrain.yaml` | The `terrain` collection.                                                                                                                                                                  |
| `common/map.yaml`     | `defines.map`: image size and projection.                                                                                                                                                  |
| `history/1936.yaml`   | The `setups` collection: one record per scenario, with state ownership.                                                                                                                    |

### `defines.map`

```yaml
defines:
  map:
    image: map/provinces.png # path inside the mod
    width: 3072 # pixels; must match the PNG
    height: 3160
    projection: equirectangular # x = (lon - lon_min) * cos(standard_parallel) * scale
    standard_parallel: 50 # degrees; corrects east-west stretch at mid-latitudes
    lon_min: -12 # longitude at the left edge of pixel column 0
    lon_max: 50 # longitude at the right edge of the last column
    lat_max: 71 # latitude at the top edge of row 0
    # lat_min is derived: lat_max - height / scale, where
    # scale = width / ((lon_max - lon_min) * cos(standard_parallel)) pixels per degree of latitude
```

Pixel (x, y) center maps to `lon = lon_min + (x + 0.5) / (scale * cos(sp))`,
`lat = lat_max - (y + 0.5) / scale`, with `scale` as above.

### `provinces.csv`

```
id,color,kind,terrain,state
1,#3a1f9c,land,plains,brandenburg
2,#0a2a6b,sea,ocean,
3,#2255aa,lake,lake,
```

| Column    | Rules                                                                                                                                                         |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`      | Positive integer, unique. Ids need not be contiguous; the engine assigns dense indices.                                                                       |
| `color`   | `#rrggbb`, unique, must appear in the PNG.                                                                                                                    |
| `kind`    | `land`, `sea` or `lake`. Lakes are impassable water that is not navigable sea.                                                                                |
| `terrain` | A `terrain` record id.                                                                                                                                        |
| `state`   | Land provinces: the id of their state. Empty for sea and lake. Duplicates the state's `provinces` list on purpose so either can be checked against the other. |

CSV files in a mod are loaded as the collection named by the file stem
(`provinces.csv` → `provinces`). The first row is the header. Fields may be quoted with `"`.
All values arrive as strings; schemas coerce them.

### `states.yaml`

```yaml
states:
  - id: brandenburg # lowercase slug: a-z, 0-9, _
    name: Brandenburg
    provinces: [1, 17, 18]
    manpower: 2700000 # optional for Phase 1
    victory_points: { 17: 10 } # optional: province id -> points
```

Every land province belongs to exactly one state.

### `terrain.yaml`

```yaml
terrain:
  - id: plains
    name: Plains
    color: [168, 182, 110] # terrain map mode color
    movement_cost: 1.0
    water: false
```

Phase 1 terrain ids: `plains`, `forest`, `hills`, `mountains`, `marsh`, `desert`, `urban`,
`jungle` (unused in Europe), `ocean`, `lake`.

### `setups` (scenario start positions)

```yaml
setups:
  - id: '1936'
    name: Road to War
    start_date: '1936-01-01'
    states:
      brandenburg: { owner: GER, cores: [GER] }
      danzig: { owner: DNZ, cores: [DNZ] }
```

Every state must have an owner in every setup. A mod changes one state's owner with
`@merge: { states: { danzig: { owner: GER } } }`.

## Engine representation

`engine/src/map/` builds a `MapModel` from the decoded RGBA pixels plus the merged
collections:

- `pixelProvince: Uint16Array` (width × height): dense province index per pixel.
- `provinceIds: Int32Array`: dense index → csv id.
- `kind: Uint8Array` (0 land, 1 sea, 2 lake), `terrain: Uint8Array` (terrain index),
  `state: Int32Array` (state index or -1).
- `adjacency`: CSR arrays (`adjStart: Uint32Array`, `adjList: Uint16Array`,
  `adjBorder: Uint32Array` = shared border length in pixel edges).
- `pixelCount`, `centroidX`, `centroidY` (Float32Array, pixel units), bounding boxes.

Neighbors are pixels sharing an edge (4-connectivity). The left and right map edges do not
wrap in Phase 1.

The PNG must not contain color-management chunks (`gAMA`, `cHRM`, `sRGB`, `iCCP`), so
browsers decode the exact colors. Decoding PNG is the caller's job: the browser uses `createImageBitmap` + a canvas; Node
tools use `tools/png.ts`.

## Validation (generator and loader both check)

- Image size matches `defines.map`.
- Every PNG color is in `provinces.csv` and every csv color appears in the PNG.
- Province ids and colors are unique.
- Every land province has a state; the state lists it back.
- No province is smaller than 4 pixels (warning below 40 for land).
- Every province is one connected region (islands may be separate provinces).
- Every setup gives every state an owner that exists in `countries`.
