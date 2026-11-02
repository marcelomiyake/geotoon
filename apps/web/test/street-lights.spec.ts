import { AreaReadySchema } from '@geotoon/contracts';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import recorded from '../../../fixtures/scene/poc-scene.json' with { type: 'json' };
import { StreetLights } from '../src/render/street-lights.js';
import { buildScene } from '../src/scene/scene-builder.js';
import {
  MAX_NEARBY_STREET_LIGHTS, STREET_LIGHT_HEIGHT_M, STREET_LIGHT_RANGE_M, STREET_LIGHT_REACH_M,
  nearbyStreetLights, streetLightsFor,
} from '../src/scene/street-lights.js';
import { Terrain } from '../src/scene/terrain.js';

const ready = AreaReadySchema.parse(recorded);

describe('street lighting', () => {
  it('reaches toward the road and follows each pole base on sloped terrain', () => {
    const terrain = new Terrain({ originM: 0, spacingM: 100, size: 2, datumM: 0, heights: [0, 10, 20, 50] });
    const lights = streetLightsFor({ terrain, poles: { count: 2, data: new Float32Array([25, 25, 0, 75, 75, Math.PI / 2]) } });
    expect(lights[0]).toEqual({ x: 25, y: 7.5 + STREET_LIGHT_HEIGHT_M - 0.15, z: 25 - STREET_LIGHT_REACH_M });
    expect(lights[1]!.x).toBeCloseTo(75 + STREET_LIGHT_REACH_M);
    expect(lights[1]!.z).toBeCloseTo(75);
    expect(lights[1]!.y).toBeCloseTo(32.5 + STREET_LIGHT_HEIGHT_M - 0.15);
    expect(streetLightsFor({ terrain, poles: { count: 0, data: new Float32Array() } })).toEqual([]);
  });

  it('selects only the nearest lamps within range, including vertical distance, without changing the source', () => {
    const lights = Array.from({ length: 20 }, (_, i) => ({ x: 20 - i, y: 7, z: 0 }));
    const selected = nearbyStreetLights(lights, 0, 1.7, 0);
    expect(selected).toHaveLength(MAX_NEARBY_STREET_LIGHTS);
    expect(selected.map((light) => light.x)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(lights[0]!.x).toBe(20);
    expect(nearbyStreetLights(lights, 100, 1.7, 0)).toEqual([]);
    expect(nearbyStreetLights([{ x: 0, y: STREET_LIGHT_RANGE_M + 1, z: 0 }], 0, 0, 0)).toEqual([]);
    expect(nearbyStreetLights([], 0, 0, 0)).toEqual([]);
  });

  it('lights the recorded scene at night, fades at twilight and extinguishes again by day', () => {
    const built = buildScene(ready.scene, ready.area);
    const street = new StreetLights(built, new THREE.MeshToonMaterial());
    const lamps = street.group.children.filter((child): child is THREE.InstancedMesh => child instanceof THREE.InstancedMesh);
    const lights = street.group.children.filter((child): child is THREE.PointLight => child instanceof THREE.PointLight);
    expect(lamps.map((mesh) => mesh.count)).toEqual([built.poles.count, built.poles.count, built.poles.count]);
    expect(lights).toHaveLength(MAX_NEARBY_STREET_LIGHTS);
    const position = streetLightsFor(built)[0]!;
    const camera = new THREE.Vector3(position.x, position.y - 5, position.z);
    const lampMaterial = lamps[2]!.material as THREE.MeshToonMaterial;
    street.update(1, camera);
    expect(lampMaterial.emissiveIntensity).toBeCloseTo(1.8);
    expect(lights.some((light) => light.intensity > 0)).toBe(true);
    street.update(0.5, camera);
    expect(lampMaterial.emissiveIntensity).toBeCloseTo(0.9);
    expect(Math.max(...lights.map((light) => light.intensity))).toBe(6);
    street.update(0, camera);
    expect(lampMaterial.emissiveIntensity).toBe(0);
    expect(lights.every((light) => light.intensity === 0)).toBe(true);
    street.update(1, new THREE.Vector3(100_000, 0, 100_000));
    expect(lights.every((light) => light.intensity === 0)).toBe(true);
  });

  it('handles scenes with no utility poles', () => {
    const built = buildScene({ ...ready.scene, lines: [] }, ready.area);
    const street = new StreetLights(built, new THREE.MeshToonMaterial());
    street.update(1, new THREE.Vector3());
    expect(street.group.children.some((child) => child instanceof THREE.PointLight)).toBe(false);
  });
});
