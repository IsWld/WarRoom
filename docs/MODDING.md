# Modding guide

WarRoom's base game is a mod called `core`. Your mod works exactly the same way.

## A mod is a folder

```
my-mod/
  mod.json
  common/
    countries.yaml
    defines.yaml
```

### `mod.json`

```json
{
  "id": "my-mod",
  "name": "My Mod",
  "version": "1.0.0",
  "dependencies": ["core"],
  "loadAfter": []
}
```

- `id`: lowercase letters, digits and hyphens. Must be unique.
- `dependencies`: mods that must be present; they load before yours.
- `loadAfter`: mods that load before yours _if_ they are present.

### Content files

Each YAML file holds one or more **collections**. A collection is a list of records, and every
record has an `id`:

```yaml
countries:
  - id: GER
    name: Germany
    color: [92, 92, 92]
```

Known collections and their fields are checked by the loader (see
`engine/src/content/schemas.ts`). Unknown collections are an error, so typos are caught.

## Changing records from another mod

Records are matched by `id`. A later mod can:

| You write                                         | Effect                                                    |
| ------------------------------------------------- | --------------------------------------------------------- |
| A full record with the same `id`                  | Replaces the record completely                            |
| `{ id: GER, "@merge": { name: "German Reich" } }` | Changes only the listed fields (nested objects merge too) |
| `{ id: GER, "@append": { cores: [AUS] } }`        | Adds items to list fields                                 |
| `{ id: GER, "@remove": true }`                    | Deletes the record                                        |

`@merge` and `@append` can be combined in one entry.

## Checking your mod

```sh
npm run validate:content           # core only
node tools/validate-content.ts content/core path/to/my-mod
```

Errors name the mod, the file, the record and the problem, and the line number when the YAML
itself is malformed.
