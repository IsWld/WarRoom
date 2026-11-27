/**
 * Node-side content loading shared by tools and tests: loads mod folders, checks
 * cross-references and, when the content includes a map, builds the map model from the PNG.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadMods } from '../engine/src/content/loader.ts';
import { checkReferences } from '../engine/src/content/references.ts';
import {
  CORE_SCHEMAS,
  type Defines,
  type ProvinceDef,
  type StateDef,
  type TerrainDef,
} from '../engine/src/content/schemas.ts';
import type { ContentError, LoadedContent } from '../engine/src/content/types.ts';
import { parseYaml } from '../engine/src/content/yaml.ts';
import { buildMapModel, countRegions, KIND_LAND, type MapModel } from '../engine/src/map/model.ts';
import { readModFolder } from './mod-folder.ts';
import { decodePng } from './png.ts';

export interface NodeContent {
  content: LoadedContent;
  map: MapModel | null;
  /** Content errors plus reference and map errors. */
  errors: ContentError[];
  warnings: string[];
}

export function loadContentFromFolders(folders: readonly string[]): NodeContent {
  const sources = folders.map(readModFolder);
  const content = loadMods(sources, parseYaml, CORE_SCHEMAS);
  const errors = [...content.errors];
  const warnings: string[] = [];
  if (errors.length > 0) return { content, map: null, errors, warnings };

  errors.push(...checkReferences(content));

  // Mod id → folder on disk, for binary assets such as the map image.
  const folderById = new Map<string, string>();
  sources.forEach((source, i) => {
    const manifest = source.files.find((f) => f.path === 'mod.json');
    try {
      const id = (JSON.parse(manifest?.text ?? '{}') as { id?: unknown }).id;
      if (typeof id === 'string') folderById.set(id, folders[i]!);
    } catch {
      // Already reported by the loader.
    }
  });

  const defines = content.defines as Defines;
  let map: MapModel | null = null;
  if (defines.map) {
    map = loadMap(defines, content, folderById, errors, warnings);
  }
  return { content, map, errors, warnings };
}

function loadMap(
  defines: Defines,
  content: LoadedContent,
  folderById: Map<string, string>,
  errors: ContentError[],
  warnings: string[],
): MapModel | null {
  const mapDefines = defines.map!;
  const imagePath = mapDefines.image;
  // The image comes from the last mod in load order that has the file.
  let file: Buffer | null = null;
  for (const mod of [...content.mods].reverse()) {
    const folder = folderById.get(mod.id);
    if (!folder) continue;
    try {
      file = readFileSync(join(folder, imagePath));
      break;
    } catch {
      // Not in this mod; try the previous one.
    }
  }
  const at = { mod: 'map', file: imagePath };
  if (!file) {
    errors.push({ mod: 'map', message: `Map image "${imagePath}" not found in any mod` });
    return null;
  }
  const image = decodePng(file);
  if (image.width !== mapDefines.width || image.height !== mapDefines.height) {
    errors.push({
      ...at,
      message: `Image is ${image.width}×${image.height}, defines.map says ${mapDefines.width}×${mapDefines.height}`,
    });
    return null;
  }
  const built = buildMapModel({
    width: image.width,
    height: image.height,
    pixels: image.pixels,
    provinces: (content.collections.provinces ?? []) as ProvinceDef[],
    states: (content.collections.states ?? []) as StateDef[],
    terrain: (content.collections.terrain ?? []) as TerrainDef[],
  });
  for (const p of built.problems) {
    errors.push({
      ...at,
      ...(p.province ? { record: `provinces/${p.province}` } : {}),
      message: p.message,
    });
  }
  const map = built.model;
  if (!map) return null;
  const regions = countRegions(map);
  for (let i = 0; i < map.provinceCount; i++) {
    const record = `provinces/${map.provinceIds[i]}`;
    if (regions[i]! > 1) {
      errors.push({
        ...at,
        record,
        message: `Province is split into ${regions[i]} separate areas`,
      });
    }
    if (map.pixelCount[i]! < 4) {
      errors.push({ ...at, record, message: `Province has only ${map.pixelCount[i]} pixel(s)` });
    } else if (map.kind[i] === KIND_LAND && map.pixelCount[i]! < 40) {
      warnings.push(`${record}: very small land province (${map.pixelCount[i]} pixels)`);
    }
  }
  return map;
}
