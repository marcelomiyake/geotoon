import type { TerrainGrid } from '@geotoon/contracts';
import { CollisionIndex } from './collision.js';
import { GROUND_LAYERS } from './ground.js';
import type { MeshData } from './mesh-buffer.js';
import { createProjection } from './projection.js';
import type { BuiltScene } from './scene-builder.js';
import { Terrain } from './terrain.js';

export interface SceneTransfer {
  readonly geometry: Omit<BuiltScene, 'collision' | 'projection' | 'terrain'>;
  readonly collision: Float64Array;
  readonly origin: { lat: number; lon: number };
  readonly terrain?: TerrainGrid;
}

export function packScene(built: BuiltScene): SceneTransfer {
  const { collision, projection, terrain, ...geometry } = built;
  return { geometry, collision: collision.toSegments(), origin: { lat: projection.lat, lon: projection.lon },
    ...(terrain.grid === undefined ? {} : { terrain: terrain.grid }) };
}

export function unpackScene(packed: SceneTransfer): BuiltScene {
  return { ...packed.geometry, collision: CollisionIndex.fromSegments(packed.collision),
    projection: createProjection(packed.origin.lat, packed.origin.lon), terrain: new Terrain(packed.terrain) };
}

/** Transfer ownership of geometry buffers instead of copying a whole city's arrays. */
export function sceneBuffers(packed: SceneTransfer): ArrayBuffer[] {
  const arrays = [packed.collision, packed.geometry.trees.data, packed.geometry.poles.data, packed.geometry.wires,
    ...packed.geometry.buildingEdges, ...packed.geometry.buildings.flatMap(meshArrays),
    ...GROUND_LAYERS.flatMap((layer) => meshArrays(packed.geometry.ground[layer]))];
  return [...new Set(arrays.map((array) => array.buffer).filter((buffer): buffer is ArrayBuffer => buffer instanceof ArrayBuffer))];
}

function meshArrays(mesh: MeshData): Float32Array[] {
  return [mesh.positions, mesh.normals, mesh.colors,
    ...(mesh.facade === undefined ? [] : [mesh.facade]),
    ...(mesh.facadeLayout === undefined ? [] : [mesh.facadeLayout])];
}
