import { describe, expect, it } from 'vitest';
import { buildIntersections } from '../src/scene/intersections.js';
import { junctionRoads, projection, road } from './street-fixture.js';

describe('connected street intersections', () => {
  it('finds a four-way junction with the real names, widths and outgoing directions', () => {
    const nodes = buildIntersections(junctionRoads(), projection, 250);
    expect(nodes).toHaveLength(1);
    expect(Math.hypot(nodes[0]!.x, nodes[0]!.z)).toBe(0);
    expect(nodes[0]!.arms).toHaveLength(4);
    expect(new Set(nodes[0]!.arms.map((arm) => arm.name))).toEqual(new Set(['Avenida Paulista', 'Alameda Campinas']));
    expect(nodes[0]!.arms.every((arm) => arm.widthM === 6 && arm.lengthM >= 40)).toBe(true);
  });

  it('handles T junctions, repeated points and multipart roads', () => {
    const a = road([[-40, 0], [0, 0], [0, 0], [40, 0]]);
    const b = road([[0, 0], [0, 30]], 'Rua Bela Vista');
    const nodes = buildIntersections([a, { ...b, coords: [[], [projection.toGeo(8, 8)], ...b.coords] }], projection, 250);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.arms).toHaveLength(3);
    expect(nodes[0]!.arms.every((arm) => Math.hypot(...arm.direction) === 1)).toBe(true);
  });

  it('does not decorate midblock bends, same-name splits, parallel roads or unconnected geometric crossings', () => {
    expect(buildIntersections([road([[-50, 0], [0, 0], [0, 50]])], projection, 250)).toEqual([]);
    expect(buildIntersections([road([[-50, 0], [0, 0]]), road([[0, 0], [0, 50]])], projection, 250)).toEqual([]);
    expect(buildIntersections([road([[-50, 0], [50, 0]]), road([[0, -50], [0, 50]], 'Bridge')], projection, 250)).toEqual([]);
    expect(buildIntersections([road([[0, 0], [50, 0]]), road([[0, 5], [50, 5]], 'Parallel')], projection, 250)).toEqual([]);
  });

  it('omits unnamed pairs, highways, railways, water and paths', () => {
    const [a, b] = junctionRoads();
    for (const kind of ['motorway', 'trunk', 'rail', 'stream', 'river', 'footway', 'path', 'other']) {
      expect(buildIntersections([a!, { ...b!, kind }], projection, 250)).toEqual([]);
    }
    expect(buildIntersections([a!, { ...b!, name: ' ' }], projection, 250)).toEqual([]);
    expect(buildIntersections([road([]), road([[0, 0], [0, 0]])], projection, 250)).toEqual([]);
  });

  it('snaps small endpoint differences, deduplicates reversed records and is independent of API order', () => {
    const a = road([[-50, 0], [0, 0], [50, 0]]);
    const b = road([[0.4, 0.2], [0.4, 50]], 'Rua Bela Vista');
    const duplicate = { ...a, id: 'copy', coords: a.coords.map((part) => part.toReversed()) };
    const nodes = buildIntersections([a, b, duplicate], projection, 250);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.arms).toHaveLength(3);
    expect(buildIntersections([duplicate, b, a], projection, 250)).toEqual(nodes);
  });

  it('keeps distant junctions throughout the loaded area while respecting the radius', () => {
    const lines = Array.from({ length: 160 }, (_, i) => [
      road([[i * 30, 0], [i * 30 + 10, 0]], `Rua ${i}`),
      road([[i * 30, 0], [i * 30, 10]], `Alameda ${i}`),
    ]).flat();
    const nodes = buildIntersections(lines, projection, 5000);
    expect(nodes).toHaveLength(160);
    expect(nodes.at(-1)!.x).toBeCloseTo(4770);
    expect(buildIntersections(lines, projection, 15)).toHaveLength(1);
  });
});
