import type { SceneBuilding, SceneLine } from '@geotoon/contracts';
import { describe, expect, it } from 'vitest';
import { CollisionIndex, type Point2 } from '../src/scene/collision.js';
import { buildIntersections } from '../src/scene/intersections.js';
import { ROAD_SIGN_KINDS, buildRoadSigns, roadSignOutline } from '../src/scene/road-signs.js';
import { buildTraffic } from '../src/scene/traffic.js';
import { junctionRoads, projection, road } from './street-fixture.js';

function signsFor(lines: readonly SceneLine[], options: { signals?: boolean; collision?: CollisionIndex;
  occupied?: readonly Point2[]; buildings?: readonly SceneBuilding[]; radiusM?: number } = {}) {
  const radiusM = options.radiusM ?? 2000;
  const collision = options.collision ?? new CollisionIndex();
  const intersections = buildIntersections(lines, projection, radiusM);
  const traffic = buildTraffic(intersections, radiusM, collision);
  const approaches = options.signals === false ? traffic.approaches.map((approach) => ({
    intersection: approach.intersection, arm: approach.arm, crossing: approach.crossing,
  })) : traffic.approaches;
  return buildRoadSigns({ intersections, approaches, lines, buildings: options.buildings ?? [],
    projection, radiusM, collision, occupied: options.occupied ?? [] });
}

function facility(kind: string, x = 0, z = 20): SceneBuilding {
  const ring = [[x - 5, z - 5], [x - 5, z + 5], [x + 5, z + 5], [x + 5, z - 5], [x - 5, z - 5]]
    .map(([px, pz]) => projection.toGeo(px!, pz!));
  return { id: kind, kind, footprint: [[ring]], heightM: 9, minHeightM: 0, heightSource: 'estimated' };
}

describe('road-sign selection at junctions', () => {
  it('warns about existing signals and crossings without putting stop or yield signs at controlled junctions', () => {
    const signs = signsFor(junctionRoads('primary'));
    expect(signs.filter((sign) => sign.kind === 'signals-ahead')).toHaveLength(4);
    expect(signs.filter((sign) => sign.kind === 'pedestrian-crossing')).toHaveLength(4);
    expect(signs.some((sign) => sign.kind === 'stop' || sign.kind === 'yield')).toBe(false);
    for (const sign of signs) {
      // A driver approaches along the sign's front normal; the post is on their right.
      const across = sign.x * Math.sin(sign.angle) - sign.z * Math.cos(sign.angle);
      expect(across).toBeCloseTo(3.9);
      const along = sign.x * Math.cos(sign.angle) + sign.z * Math.sin(sign.angle);
      expect(along).toBeCloseTo(sign.kind === 'signals-ahead' ? 30 : 20);
    }
  });

  it('puts stop signs on minor approaches to a clearly higher-priority unsignalized street', () => {
    const signs = signsFor(junctionRoads('primary'), { signals: false });
    const stops = signs.filter((sign) => sign.kind === 'stop');
    expect(stops).toHaveLength(2);
    expect(stops.every((sign) => Math.abs(sign.z) > Math.abs(sign.x))).toBe(true);
    expect(signs.filter((sign) => sign.kind === 'crossroads')).toHaveLength(2);
    expect(signs.filter((sign) => sign.kind === 'pedestrian-crossing')).toHaveLength(4);
    expect(signsFor(junctionRoads(), { signals: false }).some((sign) => sign.kind === 'stop' || sign.kind === 'yield')).toBe(false);
  });

  it('uses yield for a modest priority difference and stop for a terminating T approach', () => {
    const lines = junctionRoads('secondary');
    const tertiary = { ...lines[1]!, kind: 'tertiary' };
    expect(signsFor([lines[0]!, tertiary], { signals: false }).filter((sign) => sign.kind === 'yield')).toHaveLength(2);
    for (const z of [-50, 50]) {
      const t = [road([[-50, 0], [0, 0], [50, 0]]), road([[0, 0], [0, z]], 'Rua Termina')];
      const stops = signsFor(t, { signals: false }).filter((sign) => sign.kind === 'stop');
      expect(stops).toHaveLength(1);
      expect(Math.sign(stops[0]!.z)).toBe(Math.sign(z));
    }
  });

  it('chooses T, side-junction and Y warnings from the actual outgoing arms', () => {
    const t = [road([[-50, 0], [0, 0], [50, 0]], 'Avenida', 'primary'),
      road([[0, 0], [0, 50]], 'Rua', 'primary')];
    const signs = signsFor(t, { signals: false });
    expect(signs.some((sign) => sign.kind === 't-junction' && sign.z > 25)).toBe(true);
    expect(signs.some((sign) => sign.kind === 'junction-right' && sign.x < -25)).toBe(true);
    expect(signs.some((sign) => sign.kind === 'junction-left' && sign.x > 25)).toBe(true);
    const fork = [road([[0, 0], [50, 0]], 'A', 'primary'), road([[0, 0], [-30, 50]], 'B', 'primary'),
      road([[0, 0], [-30, -50]], 'C', 'primary')];
    expect(signsFor(fork, { signals: false }).filter((sign) => sign.kind === 'y-junction')).toHaveLength(3);
  });

  it('follows curved approach geometry rather than extending its initial tangent off the road', () => {
    const lines = [road([[-50, 0], [0, 0], [50, 0]], 'Avenida', 'primary'),
      road([[0, 0], [0, 10], [30, 10]], 'Rua Curta')];
    const stop = signsFor(lines, { signals: false }).find((sign) => sign.kind === 'stop')!;
    expect(stop.x).toBeCloseTo(1);
    expect(stop.z).toBeCloseTo(6.1);
    expect(stop.angle).toBeCloseTo(0);
  });

  it('handles a shallow side junction without requiring a perpendicular branch', () => {
    const lines = [road([[-80, 0], [0, 0], [80, 0]], 'Avenida', 'primary'),
      road([[0, 0], [80, 40]], 'Rua Diagonal', 'primary')];
    const signs = signsFor(lines, { signals: false });
    expect(signs.some((sign) => sign.kind === 'junction-right' && sign.x < -25)).toBe(true);
    expect(signs.some((sign) => sign.kind === 'junction-left' && sign.x > 25)).toBe(true);
  });

  it('skips approaches too short for an advance warning', () => {
    const lines = [road([[-18, 0], [0, 0], [18, 0]], 'Avenida', 'primary'),
      road([[0, -18], [0, 0], [0, 18]], 'Rua')];
    expect(signsFor(lines)).toEqual([]);
  });
});

describe('curve warnings and placement', () => {
  const curve = road([[-80, 0], [0, 0], [0, -80]]);

  it('warns each direction before a real bend, with the correct left/right symbol', () => {
    const signs = signsFor([curve]);
    expect(signs).toHaveLength(2);
    expect(signs.find((sign) => sign.kind === 'curve-left')).toMatchObject({ x: -30 });
    expect(signs.find((sign) => sign.kind === 'curve-right')!.z).toBeCloseTo(-30);
    const reversed = { ...curve, coords: curve.coords.map((part) => part.toReversed()) };
    expect(signsFor([reversed]).toSorted((a, b) => a.x - b.x)).toEqual(signs.toSorted((a, b) => a.x - b.x));
  });

  it('handles repeated points and avoids duplicate warnings on the same bend', () => {
    const repeated = road([[-80, 0], [0, 0], [0, 0], [0, -80]]);
    expect(signsFor([repeated, { ...repeated, id: 'duplicate' }])).toHaveLength(2);
  });

  it('does not confuse straight roads, tiny bends, hairpins, intersections or paths with standalone curves', () => {
    for (const points of [[[0, 0], [40, 0], [80, 0]], [[-10, 0], [0, 0], [0, -10]],
      [[-80, 0], [0, 0], [-80, 1]], [[0, 0], [0, 0]]] as const) {
      expect(signsFor([road(points)])).toEqual([]);
    }
    const junction = signsFor([curve, road([[0, 0], [80, 0]], 'Rua Lateral')]);
    expect(junction.some((sign) => sign.kind.startsWith('curve-'))).toBe(false);
    for (const kind of ['path', 'footway', 'rail', 'stream']) {
      expect(signsFor([{ ...curve, kind }])).toEqual([]);
    }
  });

  it('keeps posts clear of buildings, existing furniture and the area edge', () => {
    const initial = signsFor([curve]);
    const collision = new CollisionIndex();
    collision.addEdge(-32, 2, -28, 2);
    expect(signsFor([curve], { collision })).toHaveLength(1);
    expect(signsFor([curve], { occupied: [initial[0]!] })).toHaveLength(1);
    expect(signsFor([curve], { radiusM: 20 })).toEqual([]);
  });

  it('preserves deterministic placement independent of source order, including distant streets', () => {
    const other = road([[1500, 1000], [1500, 1100], [1600, 1100]], 'Rua Distante');
    const a = signsFor([curve, other]);
    expect(a).toHaveLength(4);
    expect(a.filter((sign) => Math.hypot(sign.x, sign.z) > 1000)).toHaveLength(2);
    expect(signsFor([other, curve])).toEqual(a);
  });
});

describe('facility signs and sign outlines', () => {
  it('uses school warnings only near a known school and actual crossing', () => {
    expect(signsFor(junctionRoads(), { buildings: [facility('school')] })
      .filter((sign) => sign.kind === 'school')).toHaveLength(4);
    expect(signsFor(junctionRoads(), { buildings: [facility('school', 0, 500)] })
      .some((sign) => sign.kind === 'school')).toBe(false);
  });

  it('puts blue service signs on the street nearest a mapped hospital, facing both directions', () => {
    const street = road([[-100, 0], [100, 0]]);
    const signs = signsFor([street], { buildings: [facility('hospital')] });
    expect(signs).toHaveLength(2);
    expect(signs.every((sign) => sign.kind === 'hospital' && Math.abs(sign.x) < 0.01)).toBe(true);
    expect(signs[0]!.z).toBeCloseTo(-signs[1]!.z);
    expect(signsFor([street], { buildings: [facility('hospital', 0, 500)] })).toEqual([]);
    expect(signsFor([street], { buildings: [{ ...facility('hospital'), footprint: [] }] })).toEqual([]);
  });

  it('provides recognisable octagon, inverted triangle, diamond and service-panel silhouettes', () => {
    expect(roadSignOutline('stop')).toHaveLength(8);
    expect(roadSignOutline('yield')).toHaveLength(3);
    for (const kind of ROAD_SIGN_KINDS) {
      const outline = roadSignOutline(kind);
      expect(outline.length).toBeGreaterThanOrEqual(3);
      expect(outline.flat().every((coordinate) => coordinate >= 0 && coordinate <= 1)).toBe(true);
    }
    expect(roadSignOutline('hospital')[0]).toEqual([0.1, 0]);
  });
});
