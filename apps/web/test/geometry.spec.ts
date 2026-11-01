import { describe, expect, it } from 'vitest';
import { CollisionIndex, WALKER_RADIUS_M, clampToRadius, closestOnSegment } from '../src/scene/collision.js';
import { BASE_LINE_LIFT_M, addPrismEdges, extrudePrism, isCorner, normalisePolygon } from '../src/scene/extrude.js';
import { LAYER_HEIGHT_M, addArea, addGroundDisc, layerForArea } from '../src/scene/ground.js';
import { MeshBuffer, openRing, orient, signedArea, type Vec2 } from '../src/scene/mesh-buffer.js';
import { createProjection } from '../src/scene/projection.js';
import { MITER_LIMIT, addRibbon, offsetAt } from '../src/scene/ribbons.js';
import { MAX_TREE_SCALE, MIN_TREE_SCALE, buildTrees } from '../src/scene/trees.js';

const RED = [1, 0, 0] as const;
const BLUE = [0, 0, 1] as const;
/** A 10 m square, anticlockwise seen from above (x east, z south). */
const SQUARE: Vec2[] = [
  [0, 0],
  [0, 10],
  [10, 10],
  [10, 0],
];

/** Every triangle's winding must agree with its stored normal (front faces point outward). */
function windingMatchesNormals(mesh: MeshBuffer): boolean {
  const { positions, normals, triangles } = mesh.toMeshData();
  for (let t = 0; t < triangles; t += 1) {
    const p = (k: number) => [positions[t * 9 + k * 3]!, positions[t * 9 + k * 3 + 1]!, positions[t * 9 + k * 3 + 2]!];
    const [a, b, c] = [p(0), p(1), p(2)];
    const u = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!];
    const v = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!];
    const cross = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
    const n = [normals[t * 9]!, normals[t * 9 + 1]!, normals[t * 9 + 2]!];
    if (cross[0]! * n[0]! + cross[1]! * n[1]! + cross[2]! * n[2]! <= 0) {
      return false;
    }
  }
  return true;
}

describe('projection', () => {
  const projection = createProjection(-23.548_582, -46.746_914);

  it('puts north at -z and east at +x', () => {
    const [x, z] = projection.toLocal(-46.746_914, -23.547_682);
    expect(x).toBeCloseTo(0, 6);
    expect(z).toBeCloseTo(-100.08, 1);
    expect(projection.toLocal(-46.745_934, -23.548_582)[0]).toBeCloseTo(100, 0);
  });

  it('round-trips with sub-millimetre error at 2 km', () => {
    const [lon, lat] = projection.toGeo(1414, -1414);
    const [x, z] = projection.toLocal(lon, lat);
    expect(x).toBeCloseTo(1414, 3);
    expect(z).toBeCloseTo(-1414, 3);
  });
});

describe('mesh buffer helpers', () => {
  it('measures orientation and drops closing and repeated vertices', () => {
    expect(signedArea(SQUARE)).toBe(100);
    expect(signedArea([...SQUARE].reverse())).toBe(-100);
    expect(openRing([[0, 0], [0, 0], [1, 0], [1, 1], [0, 0]])).toEqual([[0, 0], [1, 0], [1, 1]]);
    expect(signedArea(orient([...SQUARE].reverse(), true))).toBe(100);
    expect(signedArea(orient(SQUARE, false))).toBe(-100);
  });

  it('turns horizontal triangles to face up whatever their input order', () => {
    const mesh = new MeshBuffer();
    mesh.upTriangle([0, 0], [1, 0], [0, 1], 2, RED);
    mesh.upTriangle([0, 0], [0, 1], [1, 0], 2, RED);
    expect(mesh.triangles).toBe(2);
    expect(windingMatchesNormals(mesh)).toBe(true);
  });
});

describe('extrudePrism', () => {
  const prism = (polygon: Vec2[][], baseY = 0, topY = 6) => ({
    polygons: [polygon],
    baseY,
    topY,
    wallColour: RED,
    roofColour: BLUE,
  });

  it('builds 8 wall and 2 roof triangles for a square, with outward normals', () => {
    const mesh = new MeshBuffer();
    expect(extrudePrism(prism([SQUARE]), mesh)).toBe(10);
    expect(windingMatchesNormals(mesh)).toBe(true);
    const { colors, positions } = mesh.toMeshData();
    const roofColours = Array.from(colors.slice(8 * 9));
    expect(roofColours.every((value, i) => value === BLUE[i % 3])).toBe(true);
    expect(Math.max(...positions.filter((_, i) => i % 3 === 1))).toBe(6);
  });

  it('gives the same mesh for clockwise and anticlockwise input', () => {
    const a = new MeshBuffer();
    const b = new MeshBuffer();
    extrudePrism(prism([SQUARE]), a);
    extrudePrism(prism([[...SQUARE].reverse()]), b);
    expect(b.triangles).toBe(a.triangles);
    expect(windingMatchesNormals(b)).toBe(true);
  });

  it('walls holes inward and leaves them out of the roof', () => {
    const hole: Vec2[] = [[3, 3], [3, 7], [7, 7], [7, 3]];
    const mesh = new MeshBuffer();
    const triangles = extrudePrism(prism([SQUARE, hole]), mesh);
    expect(triangles).toBe(8 + 8 + 8);
    expect(windingMatchesNormals(mesh)).toBe(true);
    expect(normalisePolygon([SQUARE, hole]).map(signedArea)).toEqual([100, -16]);
  });

  it('skips empty, degenerate and upside-down prisms', () => {
    const mesh = new MeshBuffer();
    expect(extrudePrism(prism([SQUARE], 5, 5), mesh)).toBe(0);
    expect(extrudePrism(prism([[[0, 0], [1, 1]]]), mesh)).toBe(0);
    expect(extrudePrism({ ...prism([]), polygons: [[]] }, mesh)).toBe(0);
  });

  it('draws roof and base contours and a vertical at each corner', () => {
    const edges: number[] = [];
    extrudePrism(prism([SQUARE], 0, 6), new MeshBuffer(), edges);
    const segments = edges.length / 6;
    expect(segments).toBe(4 + 4 + 4);
    const ys = new Set(edges.filter((_, i) => i % 3 === 1));
    expect([...ys].sort((a, b) => a - b)).toEqual([BASE_LINE_LIFT_M, 6]);
  });

  it('leaves gentle bends of curved walls without verticals', () => {
    const circle: Vec2[] = Array.from({ length: 36 }, (_, i) => [
      Math.cos((i / 36) * Math.PI * 2) * 10,
      Math.sin((i / 36) * Math.PI * 2) * 10,
    ]);
    const edges: number[] = [];
    addPrismEdges(circle, 0, 6, edges);
    expect(edges.length / 6).toBe(36 + 36);
    expect(isCorner([0, 0], [1, 0], [2, 0])).toBe(false);
    expect(isCorner([0, 0], [1, 0], [1, 1])).toBe(true);
    expect(isCorner([0, 0], [0, 0], [1, 1])).toBe(false);
  });
});

describe('ribbons', () => {
  it('builds a strip of the requested width', () => {
    const mesh = new MeshBuffer();
    expect(addRibbon([[0, 0], [10, 0], [20, 0]], 6, 0.05, RED, mesh)).toBe(4);
    const zs = Array.from(mesh.toMeshData().positions.filter((_, i) => i % 3 === 2));
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(6, 6);
    expect(windingMatchesNormals(mesh)).toBe(true);
  });

  it('caps the miter at sharp turns', () => {
    const [x, z] = offsetAt([[0, 0], [10, 0], [0, 0.5]], 1, 3);
    expect(Math.hypot(x, z)).toBeLessThanOrEqual(3 * MITER_LIMIT + 1e-9);
    const right = offsetAt([[0, 0], [10, 0], [10, 10]], 1, 3);
    expect(Math.hypot(right[0], right[1])).toBeCloseTo(3 * Math.SQRT2, 6);
  });

  it('ignores lines that are too short or have no width', () => {
    const mesh = new MeshBuffer();
    expect(addRibbon([[0, 0], [0.0001, 0]], 6, 0, RED, mesh)).toBe(0);
    expect(addRibbon([[0, 0], [10, 0]], 0, 0, RED, mesh)).toBe(0);
  });
});

describe('ground', () => {
  it('stacks layers so flat surfaces do not fight', () => {
    expect(layerForArea('water')).toBe('water');
    expect(layerForArea('park')).toBe('green');
    expect(layerForArea('industrial')).toBe('landuse');
    expect(LAYER_HEIGHT_M.base).toBeLessThan(LAYER_HEIGHT_M.landuse);
    expect(LAYER_HEIGHT_M.landuse).toBeLessThan(LAYER_HEIGHT_M.roads);
  });

  it('fills areas at their layer height and builds the base disc', () => {
    const mesh = new MeshBuffer();
    expect(addArea([[SQUARE]], 'park', mesh)).toBe(2);
    expect(new Set(mesh.toMeshData().positions.filter((_, i) => i % 3 === 1))).toEqual(new Set([Math.fround(LAYER_HEIGHT_M.green)]));
    const disc = new MeshBuffer();
    expect(addGroundDisc(100, 16, disc)).toBe(16);
    expect(windingMatchesNormals(disc)).toBe(true);
  });
});

describe('trees', () => {
  it('packs stable per-position scale and rotation', () => {
    const first = buildTrees([[1, 2], [30, -4]]);
    const again = buildTrees([[1, 2], [30, -4]]);
    expect(first.count).toBe(2);
    expect(Array.from(first.data)).toEqual(Array.from(again.data));
    for (let i = 0; i < first.count; i += 1) {
      expect(first.data[i * 4 + 2]).toBeGreaterThanOrEqual(MIN_TREE_SCALE);
      expect(first.data[i * 4 + 2]).toBeLessThanOrEqual(MAX_TREE_SCALE);
    }
  });
});

describe('collision', () => {
  const wall = (): CollisionIndex => {
    const index = new CollisionIndex();
    index.addEdge(0, -50, 0, 50);
    return index;
  };

  it('stops a walker against a wall (a running step is 0.2 m at most)', () => {
    const index = wall();
    let position = { x: -1, z: 0 };
    for (let step = 0; step < 10; step += 1) {
      position = index.resolve(position, { x: position.x + 0.2, z: 0 });
    }
    expect(position.x).toBeLessThanOrEqual(-WALKER_RADIUS_M);
    expect(position.x).toBeGreaterThan(-WALKER_RADIUS_M - 0.01);
  });

  it('slides along a wall instead of stopping', () => {
    const result = wall().resolve({ x: -0.5, z: 0 }, { x: -0.1, z: 1 });
    expect(result.z).toBeCloseTo(1, 6);
    expect(result.x).toBeLessThanOrEqual(-WALKER_RADIUS_M);
  });

  it('pushes back to the side it came from when landing exactly on the wall', () => {
    expect(wall().resolve({ x: 2, z: 0 }, { x: 0, z: 0 }).x).toBeGreaterThan(0);
  });

  it('lets the walker move freely through empty cells', () => {
    expect(wall().resolve({ x: 100, z: 100 }, { x: 101, z: 100 })).toEqual({ x: 101, z: 100 });
    expect(new CollisionIndex().size).toBe(0);
  });

  it('finds the closest point on a segment and keeps walkers inside the area', () => {
    expect(closestOnSegment(5, 5, 0, 0, 10, 0)).toEqual([5, 0]);
    expect(closestOnSegment(5, 5, 1, 1, 1, 1)).toEqual([1, 1]);
    expect(clampToRadius({ x: 3, z: 4 }, 100, 2)).toEqual({ point: { x: 3, z: 4 }, clamped: false });
    const clamped = clampToRadius({ x: 300, z: 400 }, 100, 2);
    expect(clamped.clamped).toBe(true);
    expect(Math.hypot(clamped.point.x, clamped.point.z)).toBeCloseTo(98, 6);
  });
});
