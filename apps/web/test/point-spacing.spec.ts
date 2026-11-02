import { describe, expect, it } from 'vitest';
import { PointSpacing } from '../src/scene/point-spacing.js';

describe('point spacing', () => {
  it('enforces separation across cell boundaries and retains the exact minimum distance', () => {
    const spacing = new PointSpacing(5);
    expect(spacing.isClear({ x: 0, z: 0 })).toBe(true);
    spacing.add({ x: 0, z: 0 });
    spacing.add({ x: 1, z: 1 });
    expect(spacing.isClear({ x: -0.1, z: -0.1 })).toBe(false);
    expect(spacing.isClear({ x: 5.5, z: 1 })).toBe(false);
    expect(spacing.isClear({ x: -5, z: 0 })).toBe(true);
    expect(spacing.isClear({ x: 0, z: -5 })).toBe(true);
    expect(spacing.isClear({ x: 4.5, z: 4.5 })).toBe(false);
    expect(spacing.isClear({ x: 5, z: 5 })).toBe(true);
    expect(spacing.isClear({ x: 1000, z: -1000 })).toBe(true);
  });
});
