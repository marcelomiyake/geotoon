import { describe, expect, it } from 'vitest';
import { areaAhead, canEnterArea, sampleMovement, shouldRetarget, type AreaTarget, type MovementSample } from '../src/scene/area-streaming.js';
import { createProjection } from '../src/scene/projection.js';

const projection = createProjection(-23.56, -46.66);

describe('directional background area loading', () => {
  it.each([60, 120, 144, 240])('starts prefetching at normal walking speed on a %i FPS display', (fps) => {
    let sample: MovementSample | undefined;
    let target: AreaTarget | undefined;
    let distance = 0;
    const frameLimit = Math.ceil(301 * fps / 6);
    for (let frame = 0; frame <= frameLimit && target === undefined; frame += 1) {
      distance = frame * 6 / fps;
      const position = { x: distance, z: 0 };
      sample = sampleMovement(position, sample);
      target = areaAhead(position, sample.movement, 2000, projection);
    }
    expect(target).toBeDefined();
    expect(distance).toBeGreaterThanOrEqual(300);
    expect(distance).toBeLessThan(300.2);
    expect(projection.toLocal(target!.lon, target!.lat)[0]).toBeCloseTo(distance + 1000);
  });

  it('accumulates diagonal sub-threshold steps, retains the latest direction and resets on a new area', () => {
    const start = sampleMovement({ x: 0, z: 0 });
    const small = sampleMovement({ x: 0.02, z: -0.02 }, start);
    expect(small.movement).toEqual({ x: 0, z: 0 });
    const moved = sampleMovement({ x: 0.04, z: -0.04 }, small);
    expect(moved.movement).toEqual({ x: 0.04, z: -0.04 });
    expect(sampleMovement({ x: 0.04, z: -0.04 }, moved).movement).toEqual(moved.movement);
    expect(sampleMovement({ x: 0, z: 0 }, moved).movement).toEqual({ x: -0.04, z: 0.04 });
    expect(sampleMovement({ x: -1000, z: 0 }).movement).toEqual({ x: 0, z: 0 });
  });

  it('starts early while travelling outward, but avoids stationary or inward requests', () => {
    expect(areaAhead({ x: 100, z: 0 }, { x: 1, z: 0 }, 2000, projection)).toBeUndefined();
    expect(areaAhead({ x: 400, z: 0 }, { x: 0, z: 0 }, 2000, projection)).toBeUndefined();
    expect(areaAhead({ x: 400, z: 0 }, { x: -1, z: 0 }, 2000, projection)).toBeUndefined();
    const target = areaAhead({ x: 300, z: 0 }, { x: 1, z: 0 }, 2000, projection)!;
    const [x, z] = projection.toLocal(target.lon, target.lat);
    expect(x).toBeCloseTo(1300);
    expect(z).toBeCloseTo(0);
    expect((2000 - 300) / 15).toBeGreaterThan(100);
  });

  it('uses actual movement, including backwards or diagonal walking, rather than mouse look', () => {
    const west = areaAhead({ x: -400, z: 0 }, { x: -5, z: 0 }, 2000, projection)!;
    expect(projection.toLocal(west.lon, west.lat)[0]).toBeCloseTo(-1400);
    const diagonal = areaAhead({ x: 300, z: -300 }, { x: 1, z: -1 }, 2000, projection)!;
    const [x, z] = projection.toLocal(diagonal.lon, diagonal.lat);
    expect(x - 300).toBeCloseTo(1000 / Math.SQRT2);
    expect(z + 300).toBeCloseTo(-1000 / Math.SQRT2);
  });

  it('rejects stale windows that would put the walker near another edge and retargets substantial turns', () => {
    const [lon, lat] = projection.toGeo(1300, 0);
    const nextProjection = createProjection(lat, lon);
    expect(canEnterArea({ lat: projection.lat, lon: projection.lon }, nextProjection, 2000)).toBe(true);
    const [westLon, westLat] = projection.toGeo(-500, 0);
    expect(canEnterArea({ lat: westLat, lon: westLon }, nextProjection, 2000)).toBe(false);
    expect(shouldRetarget({ lat, lon }, { lat, lon: westLon }, projection, 2000)).toBe(true);
    expect(shouldRetarget({ lat, lon }, { lat, lon }, projection, 2000)).toBe(false);
  });

  it('keeps geographic positions continuous through repeated windows over a six-kilometre walk', () => {
    let current = projection;
    let changes = 0;
    for (let distance = 0; distance <= 6000; distance += 80) {
      const [lon, lat] = projection.toGeo(distance, 0);
      const [x, z] = current.toLocal(lon, lat);
      expect(Math.hypot(x, z)).toBeLessThan(2000);
      const target = areaAhead({ x, z }, { x: 1, z: 0 }, 2000, current);
      if (target === undefined) continue;
      current = createProjection(target.lat, target.lon);
      expect(canEnterArea({ lat, lon }, current, 2000)).toBe(true);
      const [localX, localZ] = current.toLocal(lon, lat);
      const restored = current.toGeo(localX, localZ);
      expect(restored[0]).toBeCloseTo(lon, 9);
      expect(restored[1]).toBeCloseTo(lat, 9);
      changes += 1;
    }
    expect(changes).toBeGreaterThan(3);
  });
});
