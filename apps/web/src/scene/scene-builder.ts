import type { Locality, Scene } from '@geotoon/contracts';
import { type ArchitectureStyle, architectureFor, buildingAppearance } from './architecture.js';
import { CollisionIndex } from './collision.js';
import { type LocalPolygon, extrudePrism, normalisePolygon } from './extrude.js';
import { GROUND_LAYERS, type GroundLayer, LAYER_HEIGHT_M, addArea, addGroundDisc, layerForArea } from './ground.js';
import { MeshBuffer, type MeshData, type Vec2 } from './mesh-buffer.js';
import { MARKING_COLOUR, SIDEWALK_COLOUR, lineColour } from './palette.js';
import { type Projection, createProjection } from './projection.js';
import { addRibbon } from './ribbons.js';
import {
  DASH_GAP_M,
  DASH_M,
  MARKING_WIDTH_M,
  POLE_SPACING_M,
  SIDEWALK_WIDTH_M,
  addWires,
  dashes,
  hasCentreLine,
  hasPoles,
  hasSidewalks,
  polesAlong,
} from './street.js';
import { type TreeInstances, buildTrees } from './trees.js';
import { type StreetSign, buildStreetSigns } from './street-signs.js';
import { Terrain } from './terrain.js';

/** The ground disc reaches this far past the area radius. */
export const GROUND_MARGIN_M = 50;
const GROUND_SEGMENTS = 96;
/** Buildings are grouped into square chunks so the renderer can cull distant ones. */
export const CHUNK_SIZE_M = 250;

export interface BuiltScene {
  readonly terrain: Terrain;
  readonly architecture: ArchitectureStyle;
  readonly streetSigns: readonly StreetSign[];
  readonly projection: Projection;
  readonly radiusM: number;
  /** One mesh per non-empty chunk. */
  readonly buildings: readonly MeshData[];
  /** Contour segments per chunk, as x, y, z pairs (6 floats per segment). */
  readonly buildingEdges: readonly Float32Array[];
  readonly ground: Readonly<Record<GroundLayer, MeshData>>;
  readonly trees: TreeInstances;
  /** Utility poles packed as [x, z, streetAngleRad] per pole. */
  readonly poles: { readonly data: Float32Array; readonly count: number };
  /** Overhead wires as line segments (6 floats per segment). */
  readonly wires: Float32Array;
  readonly collision: CollisionIndex;
  readonly spawn: { readonly x: number; readonly z: number; readonly headingRad: number };
  readonly stats: SceneStats;
}

export interface SceneStats {
  readonly buildings: number;
  readonly lines: number;
  readonly areas: number;
  readonly trees: number;
  readonly poles: number;
  readonly streetSigns: number;
  readonly wireSegments: number;
  readonly triangles: number;
  readonly outlineSegments: number;
  readonly collisionEdges: number;
  readonly buildMs: number;
}

export interface SceneArea {
  readonly lat: number;
  readonly lon: number;
  readonly radiusM: number;
  readonly locality?: Locality;
}

/** Turns the wire scene into typed arrays per material, a collision index and stats. */
export function buildScene(scene: Scene, area: SceneArea, now: () => number = () => performance.now()): BuiltScene {
  const started = now();
  const projection = createProjection(area.lat, area.lon);
  const project = (polygon: readonly (readonly (readonly number[])[])[]): LocalPolygon =>
    polygon.map((ring) => ring.map(([lon, lat]) => projection.toLocal(lon!, lat!)));

  const collision = new CollisionIndex();
  const terrain = new Terrain(scene.terrain);
  const architecture = architectureFor(area.locality);
  const chunks = addBuildings(scene.buildings, project, collision, architecture, terrain);
  const streetSigns = buildStreetSigns(scene.lines, projection, area.radiusM, collision);

  const ground = Object.fromEntries(GROUND_LAYERS.map((layer) => [layer, new MeshBuffer()])) as Record<
    GroundLayer,
    MeshBuffer
  >;
  addGroundDisc(area.radiusM + GROUND_MARGIN_M, GROUND_SEGMENTS, ground.base);
  for (const sceneArea of scene.areas) {
    addArea(sceneArea.polygons.map(project), sceneArea.kind, ground[layerForArea(sceneArea.kind)]);
  }
  const poles: number[] = [];
  const wires: number[] = [];
  for (const line of scene.lines) {
    for (const part of line.coords) {
      const points: Vec2[] = part.map(([lon, lat]) => projection.toLocal(lon, lat));
      addLine(line.kind, line.widthM, points, ground, poles, wires, terrain);
    }
  }

  const trees = buildTrees(scene.trees.map(([lon, lat]) => projection.toLocal(lon, lat)));
  const [spawnX, spawnZ] = projection.toLocal(scene.spawn.lon, scene.spawn.lat);

  const buildings = [...chunks.values()].map((chunk) => chunk.mesh.toMeshData()).filter((m) => m.triangles > 0);
  const buildingEdges = [...chunks.values()]
    .filter((chunk) => chunk.edges.length > 0)
    .map((chunk) => new Float32Array(chunk.edges));
  const outlineSegments = buildingEdges.reduce((sum, edges) => sum + edges.length / 6, 0);
  const groundData = Object.fromEntries(
    GROUND_LAYERS.map((layer) => [layer, layer === 'base' && terrain.grid !== undefined
      ? terrain.ground() : terrain.drape(ground[layer].toMeshData())]),
  ) as Record<GroundLayer, MeshData>;
  const triangles = [...buildings, ...Object.values(groundData)].reduce(
    (sum, mesh) => sum + mesh.triangles,
    0,
  );
  return {
    terrain,
    architecture,
    streetSigns,
    projection,
    radiusM: area.radiusM,
    buildings,
    buildingEdges,
    ground: groundData,
    trees,
    poles: { data: new Float32Array(poles), count: poles.length / 3 },
    wires: new Float32Array(wires),
    collision,
    spawn: { x: spawnX, z: spawnZ, headingRad: (scene.spawn.headingDeg * Math.PI) / 180 },
    stats: {
      buildings: scene.buildings.length,
      lines: scene.lines.length,
      areas: scene.areas.length,
      trees: trees.count,
      poles: poles.length / 3,
      streetSigns: streetSigns.length,
      wireSegments: wires.length / 6,
      triangles,
      outlineSegments,
      collisionEdges: collision.size,
      buildMs: Math.round(now() - started),
    },
  };
}

type BuildingChunk = { mesh: MeshBuffer; edges: number[] };

/** Extrudes buildings into chunks by position and indexes ground-level walls for collisions. */
function addBuildings(
  buildings: Scene['buildings'],
  project: (polygon: readonly (readonly (readonly number[])[])[]) => LocalPolygon,
  collision: CollisionIndex,
  architecture: ArchitectureStyle,
  terrain: Terrain,
): Map<string, BuildingChunk> {
  const chunks = new Map<string, BuildingChunk>();
  for (const building of buildings) {
    const polygons = building.footprint.map(project);
    const anchor = polygons[0]?.[0]?.[0];
    if (anchor === undefined) {
      continue;
    }
    const key = `${Math.floor(anchor[0] / CHUNK_SIZE_M)}:${Math.floor(anchor[1] / CHUNK_SIZE_M)}`;
    let chunk = chunks.get(key);
    if (chunk === undefined) {
      chunk = { mesh: new MeshBuffer({ facade: true }), edges: [] };
      chunks.set(key, chunk);
    }
    const { colours, pitched } = buildingAppearance(building, architecture);
    const heights = polygons.flat(2).map(([x, z]) => terrain.heightAt(x, z));
    const low = heights.reduce((a, b) => Math.min(a, b), Number.POSITIVE_INFINITY);
    const high = heights.reduce((a, b) => Math.max(a, b), Number.NEGATIVE_INFINITY);
    extrudePrism(
      {
        polygons,
        baseY: (building.minHeightM < 0.5 ? low : high) + building.minHeightM,
        topY: high + building.heightM,
        wallColour: colours.wall,
        roofColour: colours.roof,
        windowSlotM: architecture.facade.slotM,
        ...(pitched ? { tileColour: colours.tile } : {}),
      },
      chunk.mesh,
      chunk.edges,
    );
    if (building.minHeightM < 2) {
      addFootprintEdges(polygons, collision);
    }
  }
  return chunks;
}

/**
 * One line part: water as a ribbon on the water layer; streets as a ribbon plus, by kind,
 * sidewalks, a dashed centre line and utility poles with wires.
 */
function addLine(
  kind: string,
  widthM: number,
  points: readonly Vec2[],
  ground: Record<GroundLayer, MeshBuffer>,
  poles: number[],
  wires: number[],
  terrain: Terrain,
): void {
  if (kind === 'stream' || kind === 'river') {
    addRibbon(points, widthM, LAYER_HEIGHT_M.water + 0.005, lineColour(kind), ground.water);
    return;
  }
  addRibbon(points, widthM, LAYER_HEIGHT_M.roads, lineColour(kind), ground.roads);
  if (hasSidewalks(kind)) {
    addRibbon(points, widthM + SIDEWALK_WIDTH_M * 2, LAYER_HEIGHT_M.sidewalks, SIDEWALK_COLOUR, ground.sidewalks);
  }
  if (hasCentreLine(kind, widthM)) {
    for (const dash of dashes(points, DASH_M, DASH_GAP_M)) {
      addRibbon(dash, MARKING_WIDTH_M, LAYER_HEIGHT_M.markings, MARKING_COLOUR, ground.markings);
    }
  }
  if (hasPoles(kind)) {
    const placed = polesAlong(points, POLE_SPACING_M, widthM / 2 + SIDEWALK_WIDTH_M / 2);
    for (const pole of placed) {
      poles.push(pole.x, pole.z, pole.angle);
    }
    addWires(placed, wires, (x, z) => terrain.heightAt(x, z));
  }
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
