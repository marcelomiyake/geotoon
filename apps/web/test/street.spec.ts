import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../src/scene/mesh-buffer.js';
import {
  DASH_GAP_M,
  DASH_M,
  WIRES,
  WIRE_SAG_M,
  WIRE_SEGMENTS,
  addWires,
  dashes,
  hasCentreLine,
  hasPoles,
  hasSidewalks,
  polesAlong,
} from '../src/scene/street.js';

const length = (line: readonly Vec2[]): number =>
  line.slice(1).reduce((sum, point, i) => sum + Math.hypot(point[0] - line[i]![0], point[1] - line[i]![1]), 0);

describe('street kinds', () => {
  it('decides sidewalks, centre lines and poles by street kind and width', () => {
    expect(hasSidewalks('residential')).toBe(true);
    expect(hasSidewalks('footway')).toBe(false);
    expect(hasCentreLine('secondary', 9)).toBe(true);
    expect(hasCentreLine('residential', 4)).toBe(false);
    expect(hasCentreLine('service', 8)).toBe(false);
    expect(hasPoles('tertiary')).toBe(true);
    expect(hasPoles('motorway')).toBe(false);
  });
});

describe('dashes', () => {
  it('splits a straight line into dashes and gaps', () => {
    const out = dashes([[0, 0], [20, 0]], DASH_M, DASH_GAP_M);
    expect(out).toEqual([
      [[0, 0], [3, 0]],
      [[7, 0], [10, 0]],
      [[14, 0], [17, 0]],
    ]);
  });

  it('carries a dash around a bend and ends a dash at the end of the line', () => {
    const out = dashes([[0, 0], [2, 0], [2, 9]], DASH_M, DASH_GAP_M);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual([[0, 0], [2, 0], [2, 1]]);
    expect(length(out[0]!)).toBeCloseTo(DASH_M, 9);
    expect(out[1]).toEqual([[2, 5], [2, 8]]);
    expect(dashes([[0, 0], [1, 0]], DASH_M, DASH_GAP_M)).toEqual([[[0, 0], [1, 0]]]);
    expect(dashes([[0, 0]], DASH_M, DASH_GAP_M)).toEqual([]);
  });
});

describe('utility poles and wires', () => {
  it('places poles at a fixed spacing on the left side of the street', () => {
    const poles = polesAlong([[0, 0], [100, 0]], 30, 4);
    expect(poles.map((pole) => pole.x)).toEqual([15, 45, 75]);
    expect(poles.every((pole) => pole.z === 4 && pole.angle === 0)).toBe(true);
    const turned = polesAlong([[0, 0], [0, 0], [0, 50]], 30, 2);
    expect(turned).toHaveLength(2);
    expect(turned[0]!.x).toBeCloseTo(-2, 9);
    expect(turned[0]!.angle).toBeCloseTo(Math.PI / 2, 9);
    expect(polesAlong([[0, 0], [10, 0]], 30, 2)).toEqual([]);
  });

  it('hangs sagging wires between neighbouring poles', () => {
    const poles = polesAlong([[0, 0], [100, 0]], 30, 0);
    const segments: number[] = [];
    const added = addWires(poles, segments);
    expect(added).toBe((poles.length - 1) * WIRES.length * WIRE_SEGMENTS);
    expect(segments).toHaveLength(added * 6);
    const [across, y] = WIRES[0]!;
    // First wire, first span: starts at the crossarm and dips by the sag at mid-span.
    expect(segments.slice(0, 3)).toEqual([15, y, across]);
    const middle = segments[(WIRE_SEGMENTS / 2 - 1) * 6 + 4]!;
    expect(middle).toBeCloseTo(y - WIRE_SAG_M, 9);
    expect(addWires(poles.slice(0, 1), [])).toBe(0);
  });
});
