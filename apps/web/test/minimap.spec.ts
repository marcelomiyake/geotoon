import { AreaReadySchema, type Scene } from '@geotoon/contracts';
import { describe, expect, it } from 'vitest';
import recorded from '../../../fixtures/scene/poc-scene.json' with { type: 'json' };
import {
  MINIMAP_TEXTURE_SIZE, buildMinimap, minimapCrop, minimapHeading, minimapPoint,
} from '../src/scene/minimap.js';
import { createProjection } from '../src/scene/projection.js';
import { road } from './street-fixture.js';

const projection = createProjection(0, 0);
const ring = [[-20, -20], [-20, 20], [20, 20], [20, -20], [-20, -20]]
  .map(([x, z]) => projection.toGeo(x!, z!));
const empty: Scene = { buildings: [], lines: [], areas: [], trees: [],
  spawn: { lat: 0, lon: 0, headingDeg: 0 }, attribution: [] };

describe('minimap geometry', () => {
  it('projects building footprints and courtyard holes without changing the source geometry', () => {
    const hole = ring.map(([lon, lat]): [number, number] => [lon / 2, lat / 2]);
    const scene: Scene = { ...empty, buildings: [{ id: 'courtyard', kind: 'apartments', heightM: 12,
      minHeightM: 0, heightSource: 'estimated', footprint: [[ring, hole], [ring]] }] };
    const before = JSON.stringify(scene);
    const data = buildMinimap(scene, projection, 2000);
    expect(data.radiusM).toBe(2000);
    expect(data.polygons).toHaveLength(2);
    expect(data.polygons[0]!.layer).toBe('building');
    expect(data.polygons[0]!.rings).toHaveLength(2);
    expect(data.polygons[0]!.rings[0]![0]![0]).toBeCloseTo(-20);
    expect(data.polygons[0]!.rings[0]![0]![1]).toBeCloseTo(-20);
    expect(data.polygons[0]!.rings[1]![0]![0]).toBeCloseTo(-10);
    expect(JSON.stringify(scene)).toBe(before);
  });

  it('distinguishes parks, water and land use in the same local metres as the 3D scene', () => {
    const kinds = ['park', 'grass', 'forest', 'pitch', 'water', 'residential', 'industrial'];
    const data = buildMinimap({ ...empty, areas: kinds.map((kind, i) => ({ id: `area-${i}`, kind, polygons: [[ring]] })) }, projection, 250);
    expect(data.polygons.map((polygon) => polygon.layer)).toEqual(['green', 'green', 'green', 'green', 'water', 'land', 'land']);
    expect(data.polygons.every((polygon) => polygon.rings[0]!.length === 5)).toBe(true);
  });

  it('retains road widths and multipart paths while ignoring line parts too short to draw', () => {
    const kinds = ['residential', 'primary', 'river', 'stream', 'rail', 'path', 'footway', 'cycleway', 'steps'];
    const lines = kinds.map((kind) => road([[0, 0], [50, -30]], kind, kind));
    const first = lines[0]!;
    const data = buildMinimap({ ...empty, lines: [{ ...first, widthM: 14,
      coords: [[], [projection.toGeo(1, 1)], ...first.coords, ...first.coords] }, ...lines.slice(1)] }, projection, 2000);
    expect(data.lines.map((line) => line.layer)).toEqual(['road', 'road', 'road', 'water', 'water', 'rail', 'path', 'path', 'path', 'path']);
    expect(data.lines[0]!.widthM).toBe(14);
    expect(data.lines[0]!.points[1]![0]).toBeCloseTo(50);
    expect(data.lines[0]!.points[1]![1]).toBeCloseTo(-30);
  });

  it('includes every recorded building and valid line part without additional source data', () => {
    const ready = AreaReadySchema.parse(recorded);
    const data = buildMinimap(ready.scene, createProjection(ready.area.lat, ready.area.lon), ready.area.radiusM);
    expect(data.polygons.filter((polygon) => polygon.layer === 'building')).toHaveLength(
      ready.scene.buildings.reduce((count, building) => count + building.footprint.length, 0));
    expect(data.lines).toHaveLength(ready.scene.lines.flatMap((line) => line.coords.filter((part) => part.length >= 2)).length);
    expect(buildMinimap(empty, projection, 2000)).toEqual({ radiusM: 2000, polygons: [], lines: [] });
  });
});

describe('minimap following and orientation', () => {
  it('keeps the player centred and north up while streets and the searched address move', () => {
    const player = { x: 80, z: -40 };
    expect(minimapPoint(player, player, 240)).toEqual({ x: 120, z: 120 });
    expect(minimapPoint({ x: 180, z: -40 }, player, 240)).toEqual({ x: 180, z: 120 });
    expect(minimapPoint({ x: 80, z: -140 }, player, 240)).toEqual({ x: 120, z: 60 });
    expect(minimapPoint({ x: 0, z: 0 }, player, 240)).toEqual({ x: 72, z: 144 });
    expect(minimapPoint(player, player, 180)).toEqual({ x: 90, z: 90 });
  });

  it('crops a fixed local range from a bounded image, including near the loaded-area edge', () => {
    const origin = minimapCrop({ x: 0, z: 0 }, 2000);
    expect(origin.x).toBeCloseTo(921.6);
    expect(origin.y).toBeCloseTo(921.6);
    expect(origin.size).toBeCloseTo(204.8);
    const moved = minimapCrop({ x: 100, z: -100 }, 2000);
    expect(moved.x - origin.x).toBeCloseTo(51.2);
    expect(moved.y - origin.y).toBeCloseTo(-51.2);
    const east = minimapCrop({ x: 1950, z: 0 }, 2000);
    expect(east.x + east.size).toBeGreaterThan(MINIMAP_TEXTURE_SIZE);
    expect(minimapCrop({ x: -1950, z: 0 }, 2000).x).toBeLessThan(0);
    const smallerArea = minimapCrop({ x: 0, z: 0 }, 250);
    expect(smallerArea.size / origin.size).toBeCloseTo(8);
  });

  it('turns the arrow clockwise from north and wraps camera yaw in either direction', () => {
    for (const [yaw, heading] of [[0, 0], [-Math.PI / 2, Math.PI / 2], [-Math.PI, Math.PI],
      [Math.PI / 2, Math.PI * 1.5], [-Math.PI * 4, 0], [Math.PI * 4, 0]]) {
      expect(minimapHeading(yaw!)).toBeCloseTo(heading!);
    }
  });
});
