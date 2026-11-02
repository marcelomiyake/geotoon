import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { BuiltScene } from '../scene/scene-builder.js';
import {
  SIGN_CENTRE_Y_M, SIGN_HEIGHT_M, SIGN_WIDTH_M, type StreetSign,
  streetSignAtlasPages, streetSignChunks, streetSignDesign, streetSignText,
} from '../scene/street-signs.js';

const CELL_WIDTH = 384;
const CELL_HEIGHT = 128;
const COLUMNS = 4;

type Lettering = { geometry: THREE.PlaneGeometry; material: THREE.MeshBasicMaterial };

/** Paged lettering and spatially merged panels cover the whole area with few draw calls. */
export function createStreetSigns(built: BuiltScene, postMaterial: THREE.Material): THREE.Group {
  const group = new THREE.Group();
  if (built.streetSigns.length === 0) {
    return group;
  }
  const lettering = new Map<string, Lettering>();
  for (const names of streetSignAtlasPages(built.streetSigns)) {
    const material = new THREE.MeshBasicMaterial({ map: signAtlas(names, built) });
    material.userData['outlineParameters'] = { visible: false };
    names.forEach((name, index) => lettering.set(name, { material, geometry: panelGeometry(index, names.length) }));
  }
  const postGeometry = new THREE.CylinderGeometry(0.045, 0.055, SIGN_CENTRE_Y_M + SIGN_HEIGHT_M / 2, 6)
    .translate(0, (SIGN_CENTRE_Y_M + SIGN_HEIGHT_M / 2) / 2, 0);
  for (const signs of streetSignChunks(built.streetSigns)) {
    group.add(signChunk(signs, built, lettering, postGeometry, postMaterial));
  }
  lettering.forEach((letter) => letter.geometry.dispose());
  return group;
}

function signChunk(
  signs: readonly StreetSign[], built: BuiltScene, lettering: ReadonlyMap<string, Lettering>,
  postGeometry: THREE.BufferGeometry, postMaterial: THREE.Material,
): THREE.Group {
  const group = new THREE.Group();
  const posts = new THREE.InstancedMesh(postGeometry, postMaterial, signs.length);
  const faces = new Map<THREE.MeshBasicMaterial, THREE.BufferGeometry[]>();
  const base = new THREE.Matrix4();
  const local = new THREE.Matrix4();
  const world = new THREE.Matrix4();
  signs.forEach((sign, index) => {
    const groundY = built.terrain.heightAt(sign.x, sign.z);
    posts.setMatrixAt(index, base.makeTranslation(sign.x, groundY, sign.z));
    for (const spec of sign.panels) {
      const letter = lettering.get(spec.name)!;
      const geometries = faces.get(letter.material) ?? [];
      base.makeRotationY(-spec.angle).setPosition(sign.x, groundY + SIGN_CENTRE_Y_M, sign.z);
      for (const side of [0, 1]) {
        local.makeRotationY(side * Math.PI).setPosition(SIGN_WIDTH_M / 2, 0, side === 0 ? 0.025 : -0.025);
        geometries.push(letter.geometry.clone().applyMatrix4(world.multiplyMatrices(base, local)));
      }
      faces.set(letter.material, geometries);
    }
  });
  for (const [material, geometries] of faces) {
    const geometry = mergeGeometries(geometries);
    geometries.forEach((face) => face.dispose());
    geometry.computeBoundingSphere();
    group.add(new THREE.Mesh(geometry, material));
  }
  posts.computeBoundingSphere();
  group.add(posts);
  return group;
}

function panelGeometry(index: number, count: number): THREE.PlaneGeometry {
  const rows = Math.ceil(count / COLUMNS);
  const geometry = new THREE.PlaneGeometry(SIGN_WIDTH_M, SIGN_HEIGHT_M);
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < uv.count; i += 1) {
    uv.setXY(i, (index % COLUMNS + uv.getX(i)) / COLUMNS,
      1 - (Math.floor(index / COLUMNS) + 1 - uv.getY(i)) / rows);
  }
  return geometry;
}

function signAtlas(names: readonly string[], built: BuiltScene): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = CELL_WIDTH * COLUMNS;
  canvas.height = CELL_HEIGHT * Math.ceil(names.length / COLUMNS);
  const context = canvas.getContext('2d')!;
  const design = streetSignDesign(built.architecture);
  names.forEach((name, index) => {
    const x = (index % COLUMNS) * CELL_WIDTH;
    const y = Math.floor(index / COLUMNS) * CELL_HEIGHT;
    context.fillStyle = design.background;
    context.fillRect(x, y, CELL_WIDTH, CELL_HEIGHT);
    context.fillStyle = design.footer;
    context.fillRect(x, y + 100, CELL_WIDTH, 28);
    context.strokeStyle = '#c5cbd0';
    context.lineWidth = 3;
    context.strokeRect(x + 2, y + 2, CELL_WIDTH - 4, CELL_HEIGHT - 4);
    const text = streetSignText(name, built.architecture);
    context.fillStyle = design.foreground;
    context.font = '34px Arial, sans-serif';
    context.fillText(text.title, x + 14, y + 51, CELL_WIDTH - 28);
    context.font = '19px Arial, sans-serif';
    context.fillText(text.subtitle, x + 14, y + 82, CELL_WIDTH - 28);
    context.fillStyle = '#26394c';
    context.font = '16px Arial, sans-serif';
    context.fillText(design.caption, x + 14, y + 120, CELL_WIDTH - 28);
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}
