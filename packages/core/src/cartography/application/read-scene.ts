import type { GeoPoint } from '../../shared/geo-point.js';
import { attributionFor } from '../domain/attribution.js';
import { LINE_WIDTH_M, type Position, type TreeFeature } from '../domain/features.js';
import { multiPolygonAreaM2, sampleLine } from '../domain/geometry.js';
import { estimateHeight } from '../domain/height-rule.js';
import type { Scene, SceneBuilding } from '../domain/scene.js';
import { chooseSpawn } from '../domain/spawn-point.js';
import type { FeatureReader, TerrainReader } from './ports.js';

/** Spacing of trees along a mapped tree row, in metres. */
export const TREE_ROW_SPACING_M = 6;

/** Reads the stored features of an area and applies the domain rules that shape the scene. */
export class ReadScene {
  constructor(private readonly reader: FeatureReader, private readonly terrainReader?: TerrainReader) {}

  async execute(centre: GeoPoint, radiusM: number): Promise<Scene> {
    const [stored, terrain] = await Promise.all([
      this.reader.readWithin(centre, radiusM),
      this.terrainReader?.readWithin(centre, radiusM),
    ]);
    const buildings: SceneBuilding[] = stored.buildings.map((building) => {
      const height = estimateHeight({
        id: building.id,
        footprintAreaM2: multiPolygonAreaM2(building.footprint),
        sourceHeightM: building.sourceHeightM,
        numFloors: building.numFloors,
        minHeightM: building.minHeightM,
      });
      return {
        id: building.id,
        footprint: building.footprint,
        heightM: height.heightM,
        minHeightM: height.minHeightM,
        heightSource: height.source,
        kind: building.kind,
      };
    });
    return {
      centre,
      radiusM,
      buildings,
      lines: stored.lines.map((line) => ({ ...line, widthM: LINE_WIDTH_M[line.kind] })),
      areas: stored.areas,
      trees: stored.trees.flatMap(treePositions),
      spawn: chooseSpawn(centre, stored.lines, stored.buildings),
      attribution: attributionFor(terrain === undefined ? stored.datasets : [...stored.datasets, 'SRTM terrain']),
      ...(terrain === undefined ? {} : { terrain }),
    };
  }
}

function treePositions(tree: TreeFeature): Position[] {
  return tree.geometry.type === 'point'
    ? [tree.geometry.position]
    : sampleLine(tree.geometry.coords, TREE_ROW_SPACING_M);
}
