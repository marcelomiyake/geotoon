import { AreaReadySchema } from '@geotoon/contracts';
import { describe, expect, it } from 'vitest';
import recorded from '../../../fixtures/scene/poc-scene.json' with { type: 'json' };
import { CollisionIndex } from '../src/scene/collision.js';
import { buildScene } from '../src/scene/scene-builder.js';
import { packScene, sceneBuffers, unpackScene } from '../src/scene/scene-transfer.js';

describe('background scene construction transfer', () => {
  it('transfers geometry without copies and restores terrain, projection and working collision methods', () => {
    const ready = AreaReadySchema.parse(recorded);
    const source = buildScene(ready.scene, { ...ready.area, address: { lat: ready.area.lat, lon: ready.area.lon } });
    const positions = [...source.buildings[0]!.positions];
    const packed = packScene(source);
    const buffers = sceneBuffers(packed);
    expect(new Set(buffers).size).toBe(buffers.length);
    const transferred = structuredClone(packed, { transfer: buffers });
    expect(source.buildings[0]!.positions.byteLength).toBe(0);
    const restored = unpackScene(transferred);
    expect([...restored.buildings[0]!.positions]).toEqual(positions);
    expect(restored.stats).toEqual(source.stats);
    expect(restored.collision.size).toBe(source.stats.collisionEdges);
    expect(restored.collision.move({ x: 100_000, z: 100_000 }, { x: 100_001, z: 100_000 })).toEqual({ x: 100_001, z: 100_000 });
    restored.projection.toLocal(ready.area.lon, ready.area.lat).forEach((value) => expect(value).toBeCloseTo(0));
    expect(restored.terrain.heightAt(0, 0)).toBe(0);
    expect(restored.address.x).toBeCloseTo(0);
    expect(restored.address.z).toBeCloseTo(0);
  });

  it('does not duplicate grid-spanning walls and preserves blocking after deserialisation', () => {
    const collision = new CollisionIndex();
    collision.addEdge(0, -100, 0, 100);
    const walls = collision.toSegments();
    expect(walls).toHaveLength(4);
    const restored = CollisionIndex.fromSegments(walls);
    expect(restored.size).toBe(1);
    expect(restored.move({ x: -1, z: 0 }, { x: 1, z: 0 }).x).toBeLessThan(-0.29);
  });

  it('preserves elevated terrain and the original address after a moving window recentres', () => {
    const ready = AreaReadySchema.parse(recorded);
    const address = { lat: ready.area.lat, lon: ready.area.lon };
    const built = buildScene({ ...ready.scene, terrain: { originM: -100, spacingM: 100, size: 3,
      datumM: 800, heights: [0, 0, 0, 0, 5, 10, 0, 10, 20] } },
    { ...ready.area, lon: ready.area.lon + 0.005, address });
    const restored = unpackScene(structuredClone(packScene(built)));
    expect(restored.terrain.heightAt(0, 0)).toBe(5);
    expect(restored.terrain.grid?.datumM).toBe(800);
    expect(restored.address.x).toBeLessThan(-400);
    const [lon, lat] = restored.projection.toGeo(restored.address.x, restored.address.z);
    expect(lon).toBeCloseTo(address.lon, 9);
    expect(lat).toBeCloseTo(address.lat, 9);
  });
});
