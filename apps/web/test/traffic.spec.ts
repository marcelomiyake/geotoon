import { describe, expect, it } from 'vitest';
import { CollisionIndex } from '../src/scene/collision.js';
import { buildIntersections } from '../src/scene/intersections.js';
import { MeshBuffer } from '../src/scene/mesh-buffer.js';
import { Terrain } from '../src/scene/terrain.js';
import { addCrossings, buildTraffic, signalColour } from '../src/scene/traffic.js';
import { junctionRoads, projection, road } from './street-fixture.js';
import { windingMatchesNormals } from './winding.js';

const nodes = buildIntersections(junctionRoads('primary'), projection, 250);
const collision = new CollisionIndex();

describe('intersection crossings and traffic lights', () => {
  it('places a zebra crossing and a signal facing incoming traffic on each major-street approach', () => {
    const traffic = buildTraffic(nodes, 250, collision);
    expect(traffic.crossings).toHaveLength(4);
    expect(traffic.lights).toHaveLength(4);
    expect(new Set(traffic.lights.map((light) => light.phase))).toEqual(new Set([0, 1]));
    traffic.lights.forEach((light, i) => {
      const crossing = traffic.crossings[i]!;
      const ux = Math.cos(light.angle);
      const uz = Math.sin(light.angle);
      const dx = light.x - crossing.x;
      const dz = light.z - crossing.z;
      expect(dx * ux + dz * uz).toBeCloseTo(3.5);
      expect(dx * uz - dz * ux).toBeCloseTo(crossing.widthM / 2 + 0.8);
    });
  });

  it('adds crossings to residential junctions without inventing signals on quiet roads', () => {
    const residential = buildIntersections(junctionRoads(), projection, 250);
    const traffic = buildTraffic(residential, 250, collision);
    expect(traffic.crossings).toHaveLength(4);
    expect(traffic.lights).toEqual([]);
  });

  it('omits short approaches, bends and crossings beyond the area, and deduplicates nearby ones', () => {
    const short = buildIntersections([road([[-4, 0], [0, 0], [4, 0]]), road([[0, 0], [0, 4]], 'Rua Curta')], projection, 250);
    expect(buildTraffic(short, 250, collision).crossings).toEqual([]);
    const bend = buildIntersections([road([[0, 0], [30, 0]]), road([[0, 0], [0, 30]], 'Rua Bela')], projection, 250);
    expect(buildTraffic(bend, 250, collision).crossings).toEqual([]);
    expect(buildTraffic(nodes, 5, collision).crossings).toEqual([]);
    expect(buildTraffic([...nodes, ...nodes], 250, collision).crossings).toHaveLength(4);
  });

  it('does not embed a traffic-light pole in a building', () => {
    const walls = new CollisionIndex();
    const first = buildTraffic(nodes, 250, collision).lights[0]!;
    walls.addEdge(first.x - 1, first.z, first.x + 1, first.z);
    expect(buildTraffic(nodes, 250, walls).lights.length).toBeLessThan(4);
    expect(buildTraffic(nodes, 9, collision).lights).toEqual([]);
  });

  it('paints separate white zebra bars across the road, with correct winding and terrain clearance', () => {
    const mesh = new MeshBuffer();
    addCrossings([{ x: 0, z: 0, angle: 0, widthM: 6 }], mesh);
    expect(mesh.triangles).toBe(10);
    expect(windingMatchesNormals(mesh)).toBe(true);
    const positions = mesh.toMeshData().positions;
    const xs = [...positions].filter((_, i) => i % 3 === 0);
    const zs = [...positions].filter((_, i) => i % 3 === 2);
    expect(Math.max(...xs)).toBe(1.5);
    expect(Math.min(...xs)).toBe(-1.5);
    expect(Math.max(...zs)).toBe(2.25);
    expect(Math.min(...zs)).toBe(-2.25);
    const terrain = new Terrain({ originM: -10, spacingM: 20, size: 2, datumM: 0, heights: [0, 4, 2, 10] });
    const draped = terrain.drape(mesh.toMeshData()).positions;
    for (let at = 0; at < draped.length; at += 3) {
      expect(draped[at + 1]).toBeCloseTo(terrain.heightAt(draped[at]!, draped[at + 2]!) + 0.06, 5);
    }
  });
});

describe('traffic-light phases', () => {
  it('runs green, amber and all-red clearance before releasing the other axis', () => {
    for (const [seconds, a, b] of [[0, 'green', 'red'], [18, 'amber', 'red'], [21, 'red', 'red'],
      [24, 'red', 'green'], [42, 'red', 'amber'], [45, 'red', 'red'], [48, 'green', 'red']] as const) {
      expect(signalColour(0, seconds)).toBe(a);
      expect(signalColour(1, seconds)).toBe(b);
    }
    expect(signalColour(1, -24)).toBe('green');
  });

  it('never gives both axes green or amber at once', () => {
    for (let seconds = 0; seconds < 96; seconds += 0.5) {
      expect(signalColour(0, seconds) === 'red' || signalColour(1, seconds) === 'red').toBe(true);
    }
  });
});
