import { describe, expect, it } from 'vitest';
import { STAR_COUNT, STAR_RADIUS_M, buildStars } from '../src/scene/stars.js';

describe('night sky stars', () => {
  it('keeps a stable field above the horizon, behind clouds and within the sky camera', () => {
    const field = buildStars();
    expect(field).toEqual(buildStars());
    expect(field.positions).toHaveLength(STAR_COUNT * 3);
    expect(field.brightness).toHaveLength(STAR_COUNT);
    for (let i = 0; i < STAR_COUNT; i += 1) {
      expect(Math.hypot(...field.positions.slice(i * 3, i * 3 + 3))).toBeCloseTo(STAR_RADIUS_M, 2);
      expect(field.positions[i * 3 + 1]!).toBeGreaterThan(0);
      expect(field.brightness[i]!).toBeGreaterThanOrEqual(0.35);
      expect(field.brightness[i]!).toBeLessThanOrEqual(1);
    }
    for (const x of [-1, 1]) {
      for (const z of [-1, 1]) {
        expect(Array.from({ length: STAR_COUNT }, (_, i) => i)
          .some((i) => field.positions[i * 3]! * x > 0 && field.positions[i * 3 + 2]! * z > 0)).toBe(true);
      }
    }
    expect(new Set(field.brightness).size).toBeGreaterThan(100);
  });
});
