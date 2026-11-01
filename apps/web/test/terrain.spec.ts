import type { Scene, TerrainGrid } from '@geotoon/contracts';
import { describe, expect, it } from 'vitest';
import { MeshBuffer, type MeshData } from '../src/scene/mesh-buffer.js';
import { createProjection } from '../src/scene/projection.js';
import { buildScene } from '../src/scene/scene-builder.js';
import { WIRES, WIRE_SEGMENTS, addWires } from '../src/scene/street.js';
import { Terrain } from '../src/scene/terrain.js';
import { DEFAULT_PLACE, initialPlace } from '../src/ui/initial-place.js';

const GRID: TerrainGrid = { originM: -100, spacingM: 100, size: 3, datumM: 760,
  heights: [-20, -10, 0, -10, 0, 20, 0, 20, 40] };

function projectedArea(data: MeshData): number {
  let total = 0;
  const p = data.positions;
  for (let i = 0; i < p.length; i += 9) {
    total += Math.abs((p[i + 3]! - p[i]!) * (p[i + 8]! - p[i + 2]!)
      - (p[i + 6]! - p[i]!) * (p[i + 5]! - p[i + 2]!)) / 2;
  }
  return total;
}

describe('terrain surfaces', () => {
  it('retains the original flat scene when no elevations are available', () => {
    const flat = new Terrain();
    const data = new MeshBuffer().toMeshData();
    expect(flat.heightAt(20, -500)).toBe(0);
    expect(flat.ground().triangles).toBe(0);
    expect(flat.drape(data)).toBe(data);
  });

  it('samples both triangles of each cell and clamps outside the grid', () => {
    const terrain = new Terrain({ originM: 0, spacingM: 100, size: 2, datumM: 0, heights: [0, 10, 20, 50] });
    expect(terrain.heightAt(25, 25)).toBe(7.5);
    expect(terrain.heightAt(75, 75)).toBe(32.5);
    expect(terrain.heightAt(-100, 0)).toBe(0);
    expect(terrain.heightAt(200, 200)).toBe(50);
    expect(terrain.heightAt(-100, 200)).toBe(20);
  });

  it('makes upward ground faces and drapes roads exactly onto the surface without losing area', () => {
    const terrain = new Terrain(GRID);
    const ground = terrain.ground();
    expect(ground.triangles).toBe(8);
    expect(projectedArea(ground)).toBe(40_000);
    const road = new MeshBuffer();
    road.upTriangle([-120, -120], [-120, 120], [120, 120], 0.05, [1, 0, 0]);
    road.upTriangle([-120, -120], [120, 120], [120, -120], 0.05, [1, 0, 0]);
    const draped = terrain.drape(road.toMeshData());
    expect(projectedArea(draped)).toBeCloseTo(40_000, 3);
    expect(draped.triangles).toBeGreaterThan(8);
    const p = draped.positions;
    for (let i = 0; i < p.length; i += 9) {
      let x = 0;
      let z = 0;
      let y = 0;
      for (let vertex = 0; vertex < 9; vertex += 3) {
        const at = i + vertex;
        expect(p[at + 1]!).toBeCloseTo(terrain.heightAt(p[at]!, p[at + 2]!) + 0.05, 4);
        expect(draped.normals[at + 1]).toBeGreaterThan(0);
        x += p[at]! / 3;
        z += p[at + 2]! / 3;
        y += p[at + 1]! / 3;
      }
      // A road face must follow the same terrain plane even between its vertices.
      expect(y).toBeCloseTo(terrain.heightAt(x, z) + 0.05, 4);
    }
    const outside = new MeshBuffer();
    outside.upTriangle([200, 200], [200, 210], [210, 200], 0, [1, 1, 1]);
    expect(terrain.drape(outside.toMeshData()).triangles).toBe(0);
  });

  it('keeps buildings upright, foundations buried, and the roof above the highest ground', () => {
    const projection = createProjection(0, 0);
    const ring = [[0, 0], [0, 80], [80, 80], [80, 0], [0, 0]].map(([x, z]) => projection.toGeo(x!, z!));
    const scene: Scene = {
      buildings: [{ id: 'one', kind: 'office', heightM: 12, minHeightM: 0, heightSource: 'measured', footprint: [[ring]] }],
      lines: [], areas: [], trees: [], spawn: { lon: 0, lat: 0, headingDeg: 0 }, attribution: [], terrain: GRID,
    };
    const built = buildScene(scene, { lat: 0, lon: 0, radiusM: 100 });
    const heights = [...built.buildings[0]!.positions].filter((_, i) => i % 3 === 1);
    expect(Math.min(...heights)).toBeCloseTo(0);
    expect(Math.max(...heights)).toBeCloseTo(44);
    expect(built.collision.size).toBe(4);
    expect(built.terrain.heightAt(0, 0)).toBe(0);
    expect(new Set([...built.ground.base.positions].filter((_, i) => i % 3 === 1)).size).toBeGreaterThan(1);
    const raised = buildScene({ ...scene, buildings: [{ ...scene.buildings[0]!, minHeightM: 3 }] }, { lat: 0, lon: 0, radiusM: 100 });
    expect(Math.min(...[...raised.buildings[0]!.positions].filter((_, i) => i % 3 === 1))).toBeCloseTo(35);
  });

  it('hangs sagging wires between pole tops at their respective terrain heights', () => {
    const wires: number[] = [];
    addWires([{ x: 0, z: 0, angle: 0 }, { x: 30, z: 0, angle: 0 }], wires, (x) => x / 10);
    expect(wires[1]).toBe(WIRES[0]![1]);
    expect(wires[(WIRE_SEGMENTS - 1) * 6 + 4]).toBeCloseTo(WIRES[0]![1] + 3);
    expect(wires[2 * 6 + 4]).toBeLessThan(WIRES[0]![1] + 1.5);
  });
});

describe('initial address', () => {
  it('opens MASP at Av. Paulista, 1578, while honouring shared coordinates and locality', () => {
    expect(initialPlace()).toEqual(DEFAULT_PLACE);
    expect(DEFAULT_PLACE.label).toContain('Paulista, 1578');
    expect(DEFAULT_PLACE.locality).toEqual({ countryCode: 'BR', city: 'São Paulo' });
    const point = { lat: 48.85, lon: 2.35, locality: { countryCode: 'FR', city: 'Paris' } };
    expect(initialPlace(point)).toEqual({ ...point, label: '48.85, 2.35' });
  });
});
