import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { BuiltScene } from '../scene/scene-builder.js';
import {
  ROAD_SIGN_CENTRE_Y_M, ROAD_SIGN_CHUNK_M, ROAD_SIGN_KINDS, ROAD_SIGN_SIZE_M,
  roadSignOutline, type RoadSign, type RoadSignKind,
} from '../scene/road-signs.js';
import { ROAD_SIGN_COLUMNS, ROAD_SIGN_ROWS, roadSignAtlas } from './road-sign-art.js';

/** One atlas and three meshes per spatial chunk, including opaque metal backs. */
export function createRoadSigns(built: BuiltScene, poleMaterial: THREE.Material): THREE.Group {
  const group = new THREE.Group();
  group.name = 'road-signs';
  if (built.roadSigns.length === 0) return group;
  const texture = new THREE.CanvasTexture(roadSignAtlas(built.architecture.streetSign !== 'generic'));
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const material = new THREE.MeshBasicMaterial({ map: texture, alphaTest: 0.5 });
  material.userData['outlineParameters'] = { visible: false };
  const pole = new THREE.CylinderGeometry(0.035, 0.05, ROAD_SIGN_CENTRE_Y_M, 6)
    .translate(0, ROAD_SIGN_CENTRE_Y_M / 2, 0);
  const fronts = new Map(ROAD_SIGN_KINDS.map((kind, index) => [kind, frontGeometry(index)]));
  const backs = new Map(ROAD_SIGN_KINDS.map((kind) => [kind, backGeometry(kind)]));
  const chunks = new Map<string, RoadSign[]>();
  for (const sign of built.roadSigns) {
    const key = `${Math.floor(sign.x / ROAD_SIGN_CHUNK_M)}:${Math.floor(sign.z / ROAD_SIGN_CHUNK_M)}`;
    const chunk = chunks.get(key) ?? [];
    chunk.push(sign); chunks.set(key, chunk);
  }
  for (const signs of chunks.values()) {
    const posts = new THREE.InstancedMesh(pole, poleMaterial, signs.length);
    const frontParts: THREE.BufferGeometry[] = [];
    const backParts: THREE.BufferGeometry[] = [];
    const matrix = new THREE.Matrix4();
    signs.forEach((sign, index) => {
      const y = built.terrain.heightAt(sign.x, sign.z);
      posts.setMatrixAt(index, matrix.makeTranslation(sign.x, y, sign.z));
      matrix.makeRotationY(Math.PI / 2 - sign.angle).setPosition(sign.x, y + ROAD_SIGN_CENTRE_Y_M, sign.z);
      frontParts.push(fronts.get(sign.kind)!.clone().applyMatrix4(matrix));
      backParts.push(backs.get(sign.kind)!.clone().applyMatrix4(matrix));
    });
    posts.computeBoundingSphere();
    group.add(posts, merged(frontParts, material, 'road-sign-fronts'), merged(backParts, poleMaterial, 'road-sign-backs'));
  }
  fronts.forEach((geometry) => geometry.dispose());
  backs.forEach((geometry) => geometry.dispose());
  return group;
}

function merged(parts: THREE.BufferGeometry[], material: THREE.Material, name: string): THREE.Mesh {
  const geometry = mergeGeometries(parts);
  parts.forEach((part) => part.dispose());
  geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  return mesh;
}

function frontGeometry(index: number): THREE.PlaneGeometry {
  const geometry = new THREE.PlaneGeometry(ROAD_SIGN_SIZE_M, ROAD_SIGN_SIZE_M).translate(0, 0, 0.005);
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < uv.count; i += 1) {
    uv.setXY(i, (index % ROAD_SIGN_COLUMNS + uv.getX(i)) / ROAD_SIGN_COLUMNS,
      1 - (Math.floor(index / ROAD_SIGN_COLUMNS) + 1 - uv.getY(i)) / ROAD_SIGN_ROWS);
  }
  return geometry;
}

function backGeometry(kind: RoadSignKind): THREE.ExtrudeGeometry {
  const outline = roadSignOutline(kind);
  const shape = new THREE.Shape(outline.map(([x, y]) =>
    new THREE.Vector2((x - 0.5) * ROAD_SIGN_SIZE_M, (0.5 - y) * ROAD_SIGN_SIZE_M)));
  return new THREE.ExtrudeGeometry(shape, { depth: 0.04, bevelEnabled: false, steps: 1 }).translate(0, 0, -0.04);
}
