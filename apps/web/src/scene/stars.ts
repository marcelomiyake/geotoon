import { fnv1a32 } from './palette.js';

export const STAR_COUNT = 1000;
export const STAR_RADIUS_M = 4800;

/** A stable upper-hemisphere field, generated once rather than changing every frame. */
export function buildStars(): { positions: Float32Array; brightness: Float32Array } {
  const positions = new Float32Array(STAR_COUNT * 3);
  const brightness = new Float32Array(STAR_COUNT);
  for (let i = 0; i < STAR_COUNT; i += 1) {
    const azimuth = fnv1a32(`star:${i}:azimuth`) / 2 ** 32 * Math.PI * 2;
    const y = 0.06 + fnv1a32(`star:${i}:height`) / 2 ** 32 * 0.94;
    const horizontal = Math.sqrt(1 - y * y);
    positions.set([Math.cos(azimuth) * horizontal * STAR_RADIUS_M, y * STAR_RADIUS_M,
      Math.sin(azimuth) * horizontal * STAR_RADIUS_M], i * 3);
    brightness[i] = 0.35 + fnv1a32(`star:${i}:brightness`) / 2 ** 32 * 0.65;
  }
  return { positions, brightness };
}
