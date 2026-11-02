import type { BuiltScene } from './scene-builder.js';

export const STREET_LIGHT_HEIGHT_M = 6.9;
export const STREET_LIGHT_REACH_M = 1.9;
export const STREET_LIGHT_RANGE_M = 32;
/** Only nearby lamps need real lights; all distant lamp faces still glow. */
export const MAX_NEARBY_STREET_LIGHTS = 8;

export interface StreetLight {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** The lamp reaches from the existing utility pole toward the road, below its wires. */
export function streetLightsFor(built: Pick<BuiltScene, 'poles' | 'terrain'>): StreetLight[] {
  const lights: StreetLight[] = [];
  for (let i = 0; i < built.poles.count; i += 1) {
    const x = built.poles.data[i * 3]!;
    const z = built.poles.data[i * 3 + 1]!;
    const angle = built.poles.data[i * 3 + 2]!;
    lights.push({
      x: x + Math.sin(angle) * STREET_LIGHT_REACH_M,
      y: built.terrain.heightAt(x, z) + STREET_LIGHT_HEIGHT_M - 0.15,
      z: z - Math.cos(angle) * STREET_LIGHT_REACH_M,
    });
  }
  return lights;
}

export function nearbyStreetLights(lights: readonly StreetLight[], x: number, y: number, z: number): StreetLight[] {
  const distance = (light: StreetLight): number => (light.x - x) ** 2 + (light.y - y) ** 2 + (light.z - z) ** 2;
  return lights.filter((light) => distance(light) < STREET_LIGHT_RANGE_M ** 2)
    .sort((a, b) => distance(a) - distance(b))
    .slice(0, MAX_NEARBY_STREET_LIGHTS);
}
