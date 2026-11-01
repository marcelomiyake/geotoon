import { AreaReadySchema } from '@geotoon/contracts';
import { describe, expect, it } from 'vitest';
import recorded from '../../../fixtures/scene/poc-scene.json' with { type: 'json' };
import { MeshBuffer } from '../src/scene/mesh-buffer.js';
import { extrudePrism } from '../src/scene/extrude.js';
import {
  GROUND_COLOUR,
  INK_COLOUR,
  ROOF_COLOURS,
  WALL_COLOURS,
  areaColour,
  buildingColours,
  hexToRgb,
  lineColour,
  srgbToLinear,
} from '../src/scene/palette.js';
import { GROUND_MARGIN_M, buildScene } from '../src/scene/scene-builder.js';

// Recorded by the G2 integration test from the Overture fixture (radius 250 m).
const ready = AreaReadySchema.parse(recorded);

describe('buildScene on the recorded PoC payload', () => {
  const built = buildScene(ready.scene, ready.area);

  it('counts every layer of the payload', () => {
    expect(built.stats).toMatchObject({
      buildings: ready.scene.buildings.length,
      lines: ready.scene.lines.length,
      areas: ready.scene.areas.length,
      trees: ready.scene.trees.length,
    });
    expect(built.stats.buildings).toBeGreaterThan(100);
    expect(built.trees.count).toBe(ready.scene.trees.length);
  });

  it('gives every building triangles and contour lines', () => {
    const projection = built.projection;
    for (const building of ready.scene.buildings) {
      const mesh = new MeshBuffer();
      const edges: number[] = [];
      const polygons = building.footprint.map((polygon) =>
        polygon.map((ring) => ring.map(([lon, lat]) => projection.toLocal(lon, lat))),
      );
      const triangles = extrudePrism(
        { polygons, baseY: building.minHeightM, topY: building.heightM, wallColour: [1, 1, 1], roofColour: [1, 1, 1] },
        mesh,
        edges,
      );
      expect(triangles, building.id).toBeGreaterThanOrEqual(4);
      expect(edges.length, building.id).toBeGreaterThan(0);
    }
    const chunkTriangles = built.buildings.reduce((sum, chunk) => sum + chunk.triangles, 0);
    expect(chunkTriangles).toBeGreaterThan(ready.scene.buildings.length * 4);
    expect(built.stats.outlineSegments).toBe(built.buildingEdges.reduce((sum, e) => sum + e.length / 6, 0));
  });

  it('lays the ground disc just past the radius and fills the layers it needs', () => {
    const { positions } = built.ground.base;
    let farthest = 0;
    for (let i = 0; i < positions.length; i += 3) {
      farthest = Math.max(farthest, Math.hypot(positions[i]!, positions[i + 2]!));
    }
    expect(farthest).toBeCloseTo(ready.area.radiusM + GROUND_MARGIN_M, 3);
    for (const chunk of built.buildings) {
      let nearest = Number.POSITIVE_INFINITY;
      for (let i = 0; i < chunk.positions.length; i += 3) {
        nearest = Math.min(nearest, Math.hypot(chunk.positions[i]!, chunk.positions[i + 2]!));
      }
      expect(nearest).toBeLessThan(ready.area.radiusM);
    }
    expect(built.ground.roads.triangles).toBeGreaterThan(0);
    expect(built.collision.size).toBeGreaterThan(0);
  });

  it('places the spawn near the address with the API heading', () => {
    expect(Math.hypot(built.spawn.x, built.spawn.z)).toBeLessThan(150);
    expect(built.spawn.headingRad).toBeCloseTo((ready.scene.spawn.headingDeg * Math.PI) / 180, 9);
  });

  it('times the build with the injected clock', () => {
    let tick = 0;
    const timed = buildScene(ready.scene, ready.area, () => (tick += 40));
    expect(timed.stats.buildMs).toBe(40);
  });
});

describe('palette', () => {
  it('converts design colours from sRGB to linear light', () => {
    expect(srgbToLinear(0)).toBe(0);
    expect(srgbToLinear(1)).toBeCloseTo(1, 9);
    expect(srgbToLinear(0.5)).toBeCloseTo(0.214, 3);
    expect(srgbToLinear(0.02)).toBeCloseTo(0.02 / 12.92, 9);
    expect(hexToRgb(0xff8000)).toEqual([1, srgbToLinear(128 / 255), 0]);
  });

  it('gives each building stable wall and roof colours from the palettes', () => {
    const colours = buildingColours('00011ca5-cfd6-4f62-bd76-9e2c3e86285f');
    expect(buildingColours('00011ca5-cfd6-4f62-bd76-9e2c3e86285f')).toEqual(colours);
    expect(WALL_COLOURS).toContainEqual(colours.wall);
    expect(ROOF_COLOURS).toContainEqual(colours.roof);
    const walls = new Set(Array.from({ length: 200 }, (_, i) => buildingColours(`b${i}`).wall.join()));
    expect(walls.size).toBe(WALL_COLOURS.length);
  });

  it('falls back to the "other" colour for unknown kinds', () => {
    expect(areaColour('glacier')).toEqual(areaColour('other'));
    expect(lineColour('runway')).toEqual(lineColour('other'));
    expect(areaColour('water')).not.toEqual(areaColour('park'));
    expect(GROUND_COLOUR.every((c) => c > 0 && c <= 1)).toBe(true);
    expect(INK_COLOUR).toBeLessThan(0x333333);
  });
});
