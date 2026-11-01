import { describe, expect, it } from 'vitest';
import { MeshBuffer, NO_FACADE, faceNormal, orient, type Vec2 } from '../src/scene/mesh-buffer.js';
import {
  EAVE_OVERHANG_M,
  MAX_GABLE_AREA_M2,
  ROOF_PITCH_DEG,
  addGableRoof,
  gableCorners,
} from '../src/scene/roof.js';
import { windingMatchesNormals } from './winding.js';

const RED = [1, 0, 0] as const;
const BLUE = [0, 0, 1] as const;

describe('mesh buffer quads and facades', () => {
  it('computes unit face normals and orients quads toward the requested side', () => {
    expect(faceNormal([0, 0, 0], [0, 0, 1], [1, 0, 0])).toEqual([0, 1, 0]);
    expect(faceNormal([0, 0, 0], [0, 0, 0], [1, 0, 0])).toEqual([0, 0, 0]);
    const mesh = new MeshBuffer();
    mesh.quad([0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1], RED, [0, 1, 0]);
    mesh.quad([0, 0, 0], [0, 0, 1], [1, 0, 1], [1, 0, 0], RED, [0, -1, 0]);
    const { normals } = mesh.toMeshData();
    expect(normals[1]).toBe(1);
    expect(normals[6 * 3 + 1]).toBe(-1);
    expect(windingMatchesNormals(mesh)).toBe(true);
  });

  it('records facade coordinates only when asked, defaulting to "not a wall"', () => {
    const plain = new MeshBuffer();
    plain.upTriangle([0, 0], [1, 0], [0, 1], 0, RED);
    expect(plain.toMeshData().facade).toBeUndefined();
    const walls = new MeshBuffer({ facade: true });
    walls.upTriangle([0, 0], [1, 0], [0, 1], 0, RED);
    expect(Array.from(walls.toMeshData().facade ?? [])).toEqual([...NO_FACADE, ...NO_FACADE, ...NO_FACADE]);
  });
});

describe('gable roofs', () => {
  const rectangle: Vec2[] = [[0, 0], [0, 12], [6, 12], [6, 0]];

  it('runs the ridge along the long side', () => {
    const corners = gableCorners(orient(rectangle, true))!;
    const [a, b] = corners;
    expect(Math.hypot(b[0] - a[0], b[1] - a[1])).toBeCloseTo(6, 9);
    expect(gableCorners(orient([[0, 0], [0, 6], [12, 6], [12, 0]], true))).toBeDefined();
  });

  it('ignores straight-through vertices but rejects other shapes and sizes', () => {
    expect(gableCorners(orient([[0, 0], [0, 6], [0, 12], [6, 12], [6, 0]], true))).toBeDefined();
    expect(gableCorners(orient([[0, 0], [0, 10], [5, 14], [10, 10], [10, 0]], true))).toBeUndefined();
    expect(gableCorners(orient([[0, 0], [0, 3], [3, 3], [3, 0]], true))).toBeUndefined();
    const side = Math.sqrt(MAX_GABLE_AREA_M2) + 1;
    expect(gableCorners(orient([[0, 0], [0, side], [side, side], [side, 0]], true))).toBeUndefined();
    expect(gableCorners(orient([[0, 0], [5, 10], [15, 10], [10, 0]], true))).toBeUndefined();
  });

  it('raises the ridge by the pitch and lets the eaves overhang below the wall top', () => {
    const mesh = new MeshBuffer();
    const edges: number[] = [];
    addGableRoof(gableCorners(orient(rectangle, true))!, 5, RED, BLUE, mesh, edges);
    const ys = Array.from(mesh.toMeshData().positions.filter((_, i) => i % 3 === 1));
    const tan = Math.tan((ROOF_PITCH_DEG * Math.PI) / 180);
    expect(Math.max(...ys)).toBeCloseTo(5 + 3 * tan, 4);
    expect(Math.min(...ys)).toBeLessThan(5 - EAVE_OVERHANG_M * tan);
    const xs = Array.from(mesh.toMeshData().positions.filter((_, i) => i % 3 === 0));
    expect(Math.min(...xs)).toBeCloseTo(-EAVE_OVERHANG_M, 4);
    expect(windingMatchesNormals(mesh)).toBe(true);
    expect(edges.length / 6).toBe(9);
  });
});
