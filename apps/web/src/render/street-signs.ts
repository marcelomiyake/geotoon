import * as THREE from 'three';
import type { BuiltScene } from '../scene/scene-builder.js';
import {
  SIGN_CENTRE_Y_M, SIGN_HEIGHT_M, SIGN_WIDTH_M, streetSignDesign, streetSignText,
} from '../scene/street-signs.js';

const CELL_WIDTH = 384;
const CELL_HEIGHT = 128;
const COLUMNS = 4;

/** A single shared text atlas; each panel has two readable faces and a metal post. */
export function createStreetSigns(built: BuiltScene, postMaterial: THREE.Material): THREE.Group {
  const group = new THREE.Group();
  if (built.streetSigns.length === 0) {
    return group;
  }
  const names = [...new Set(built.streetSigns.flatMap((sign) => sign.panels.map((panel) => panel.name)))];
  const atlas = signAtlas(names, built);
  const panelMaterial = new THREE.MeshBasicMaterial({ map: atlas });
  panelMaterial.userData['outlineParameters'] = { visible: false };
  const postGeometry = new THREE.CylinderGeometry(0.045, 0.055, SIGN_CENTRE_Y_M + SIGN_HEIGHT_M / 2, 6)
    .translate(0, (SIGN_CENTRE_Y_M + SIGN_HEIGHT_M / 2) / 2, 0);
  const posts = new THREE.InstancedMesh(postGeometry, postMaterial, built.streetSigns.length);
  const matrix = new THREE.Matrix4();
  const panels = new Map(names.map((name, index) => [name, panelGeometry(index, names.length)]));
  built.streetSigns.forEach((sign, index) => {
    const groundY = built.terrain.heightAt(sign.x, sign.z);
    matrix.makeTranslation(sign.x, groundY, sign.z);
    posts.setMatrixAt(index, matrix);
    for (const spec of sign.panels) {
      const panel = new THREE.Group();
      panel.position.set(sign.x, groundY + SIGN_CENTRE_Y_M, sign.z);
      panel.rotation.y = -spec.angle;
      const geometry = panels.get(spec.name)!;
      const front = new THREE.Mesh(geometry, panelMaterial);
      const back = new THREE.Mesh(geometry, panelMaterial);
      front.position.set(SIGN_WIDTH_M / 2, 0, 0.025);
      back.position.set(SIGN_WIDTH_M / 2, 0, -0.025);
      back.rotation.y = Math.PI;
      panel.add(front, back);
      group.add(panel);
    }
  });
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
