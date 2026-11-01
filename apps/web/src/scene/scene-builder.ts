import type { Scene } from '@geotoon/contracts';
import { CollisionIndex } from './collision.js';
import { type LocalPolygon, extrudePrism, normalisePolygon } from './extrude.js';
import { type GroundLayer, LAYER_HEIGHT_M, addArea, addGroundDisc, layerForArea } from './ground.js';
import { MeshBuffer, type MeshData, type Vec2 } from './mesh-buffer.js';
import { buildingColours, lineColour } from './palette.js';
import { type Projection, createProjection } from './projection.js';
import { addRibbon } from './ribbons.js';
import { type TreeInstances, buildTrees } from './trees.js';

/** The ground disc reaches this far past the area radius. */
export const GROUND_MARGIN_M = 50;
const GROUND_SEGMENTS = 96;
/** Buildings are grouped into square chunks so the renderer can cull distant ones. */
export const CHUNK_SIZE_M = 250;

export interface BuiltScene {
  readonly projection: Projection;
  readonly radiusM: number;
  /** One mesh per non-empty chunk. */
  readonly buildings: readonly MeshData[];
  readonly ground: Readonly<Record<GroundLayer, MeshData>>;
  readonly trees: TreeInstances;
  readonly collision: CollisionIndex;
  readonly spawn: { readonly x: number; readonly z: number; readonly headingRad: number };
  readonly stats: SceneStats;
}

export interface SceneStats {
  readonly buildings: number;
  readonly lines: number;
  readonly areas: number;
  readonly trees: number;
  readonly triangles: number;
  readonly collisionEdges: number;
  readonly buildMs: number;
}

export interface SceneArea {
  readonly lat: number;
  readonly lon: number;
  readonly radiusM: number;
}

/** Turns the wire scene into typed arrays per material, a collision index and stats. */
export function buildScene(scene: Scene, area: SceneArea, now: () => number = () => performance.now()): BuiltScene {
  const started = now();
  const projection = createProjection(area.lat, area.lon);
  const project = (polygon: readonly (readonly (readonly number[])[])[]): LocalPolygon =>
    polygon.map((ring) => ring.map(([lon, lat]) => projection.toLocal(lon!, lat!)));

  const collision = new CollisionIndex();
  const chunks = new Map<string, MeshBuffer>();
  for (const building of scene.buildings) {
    const polygons = building.footprint.map(project);
    const anchor = polygons[0]?.[0]?.[0];
    if (anchor === undefined) {
      continue;
    }
    const key = `${Math.floor(anchor[0] / CHUNK_SIZE_M)}:${Math.floor(anchor[1] / CHUNK_SIZE_M)}`;
    let buildingBuffer = chunks.get(key);
    if (buildingBuffer === undefined) {
      buildingBuffer = new MeshBuffer();
      chunks.set(key, buildingBuffer);
    }
    const colours = buildingColours(building.id);
    extrudePrism(
      {
        polygons,
        baseY: building.minHeightM,
        topY: building.heightM,
        wallColour: colours.wall,
        roofColour: colours.roof,
      },
      buildingBuffer,
    );
    if (building.minHeightM < 2) {
      addFootprintEdges(polygons, collision);
    }
  }

  const ground: Record<GroundLayer, MeshBuffer> = {
    base: new MeshBuffer(),
    landuse: new MeshBuffer(),
    green: new MeshBuffer(),
    water: new MeshBuffer(),
    roads: new MeshBuffer(),
  };
  addGroundDisc(area.radiusM + GROUND_MARGIN_M, GROUND_SEGMENTS, ground.base);
  for (const sceneArea of scene.areas) {
    addArea(sceneArea.polygons.map(project), sceneArea.kind, ground[layerForArea(sceneArea.kind)]);
  }
  for (const line of scene.lines) {
    const target = line.kind === 'stream' || line.kind === 'river' ? ground.water : ground.roads;
    const y = target === ground.water ? LAYER_HEIGHT_M.water + 0.005 : LAYER_HEIGHT_M.roads;
    for (const part of line.coords) {
      const points: Vec2[] = part.map(([lon, lat]) => projection.toLocal(lon, lat));
      addRibbon(points, line.widthM, y, lineColour(line.kind), target);
    }
  }

  const trees = buildTrees(scene.trees.map(([lon, lat]) => projection.toLocal(lon, lat)));
  const [spawnX, spawnZ] = projection.toLocal(scene.spawn.lon, scene.spawn.lat);

  const buildings = [...chunks.values()].map((chunk) => chunk.toMeshData()).filter((m) => m.triangles > 0);
  const groundData = {
    base: ground.base.toMeshData(),
    landuse: ground.landuse.toMeshData(),
    green: ground.green.toMeshData(),
    water: ground.water.toMeshData(),
    roads: ground.roads.toMeshData(),
  };
  const triangles = [...buildings, ...Object.values(groundData)].reduce(
    (sum, mesh) => sum + mesh.triangles,
    0,
  );
  return {
    projection,
    radiusM: area.radiusM,
    buildings,
    ground: groundData,
    trees,
    collision,
    spawn: { x: spawnX, z: spawnZ, headingRad: (scene.spawn.headingDeg * Math.PI) / 180 },
    stats: {
      buildings: scene.buildings.length,
      lines: scene.lines.length,
      areas: scene.areas.length,
      trees: trees.count,
      triangles,
      collisionEdges: collision.size,
      buildMs: Math.round(now() - started),
    },
  };
}

function addFootprintEdges(polygons: readonly LocalPolygon[], collision: CollisionIndex): void {
  for (const polygon of polygons) {
    for (const ring of normalisePolygon(polygon)) {
      for (let i = 0; i < ring.length; i += 1) {
        const a = ring[i]!;
        const b = ring[(i + 1) % ring.length]!;
        collision.addEdge(a[0], a[1], b[0], b[1]);
      }
    }
  }
}
