import { describe, expect, it } from 'vitest';
import { architectureFor } from '../src/scene/architecture.js';
import { CollisionIndex } from '../src/scene/collision.js';
import { buildIntersections, type Intersection } from '../src/scene/intersections.js';
import { MAX_STREET_SIGNS, buildStreetSigns, streetSignDesign, streetSignText } from '../src/scene/street-signs.js';
import { junctionRoads, projection, road } from './street-fixture.js';

const nodes = buildIntersections(junctionRoads(), projection, 250);

describe('street-name sign placement', () => {
  it('puts two real names on one sidewalk corner post, with panels parallel to each street', () => {
    const signs = buildStreetSigns(nodes, 250);
    expect(signs).toHaveLength(1);
    const sign = signs[0]!;
    expect(Math.abs(sign.x)).toBeCloseTo(3.9);
    expect(Math.abs(sign.z)).toBeCloseTo(3.9);
    expect(new Set(sign.panels.map((panel) => panel.name))).toEqual(new Set(['Avenida Paulista', 'Alameda Campinas']));
    expect(Math.abs(Math.sin(sign.panels[0].angle - sign.panels[1].angle))).toBeCloseTo(1);
  });

  it('does not repeat signs between corners, even along long streets', () => {
    const isolated = buildIntersections([road([[-1000, 0], [1000, 0]])], projection, 2000);
    expect(buildStreetSigns(isolated, 2000)).toEqual([]);
  });

  it('chooses another corner when a building blocks the first one', () => {
    const first = buildStreetSigns(nodes, 250)[0]!;
    const collision = new CollisionIndex();
    collision.addEdge(first.x - 2, first.z, first.x + 2, first.z);
    const signs = buildStreetSigns(nodes, 250, collision);
    expect(signs).toHaveLength(1);
    expect(signs[0]).not.toEqual(first);
  });

  it('omits corners outside the area or with no clear path from the junction', () => {
    expect(buildStreetSigns(nodes, 2)).toEqual([]);
    const corner = buildIntersections([road([[0, 0], [40, 0]]), road([[0, 0], [0, 40]], 'Rua Bela Vista')], projection, 250);
    const collision = new CollisionIndex();
    collision.addEdge(-10, 3, 20, 3);
    expect(buildStreetSigns(corner, 250, collision)).toEqual([]);
  });

  it('rejects collinear, same-name and unnamed corner pairs', () => {
    const arm = nodes[0]!.arms[0]!;
    for (const other of [{ ...arm, name: '' }, { ...arm, direction: [0, 1] as const },
      { ...arm, name: 'Other', direction: arm.direction }]) {
      expect(buildStreetSigns([{ x: 0, z: 0, arms: [arm, other] }], 250)).toEqual([]);
    }
  });

  it('deduplicates crowded corner posts and bounds the number of signs', () => {
    const base = nodes[0]!;
    expect(buildStreetSigns([base, { ...base, x: 1 }], 250)).toHaveLength(1);
    const many: Intersection[] = Array.from({ length: 160 }, (_, i) => ({ ...base, x: i * 30 }));
    expect(buildStreetSigns(many, 5000)).toHaveLength(MAX_STREET_SIGNS);
    expect(buildStreetSigns(many, 5000).at(-1)!.x).toBeLessThan(4000);
  });
});

describe('street-name sign lettering', () => {
  it('uses the São Paulo reference colours and keeps full street names without invented postal codes', () => {
    const style = architectureFor({ countryCode: 'BR', city: 'São Paulo' });
    expect(streetSignDesign(style)).toEqual({ background: '#07549a', foreground: '#ffffff', footer: '#d8dcdf', caption: 'São Paulo' });
    expect(streetSignText('Avenida Paulista', style)).toEqual({ title: 'Paulista', subtitle: 'Avenida Paulista' });
    expect(streetSignText('Al. Joaquim Eugênio de Lima', style).title).toBe('Joaquim Eugênio de Lima');
    expect(streetSignText('Rua ', style).title).toBe('Rua ');
    expect(streetSignText('São João', style).title).toBe('São João');
  });

  it('uses a country fallback for Brazil and neutral signs elsewhere', () => {
    const brazil = architectureFor({ countryCode: 'BR', city: 'Recife' });
    expect(streetSignDesign(brazil).background).toBe('#07549a');
    expect(streetSignDesign(brazil).caption).toBe('');
    const fallback = architectureFor();
    expect(streetSignDesign(fallback).background).toBe('#f4efdf');
    expect(streetSignText('Rue de Rivoli', fallback)).toEqual({ title: 'Rue de Rivoli', subtitle: 'Rue de Rivoli' });
  });
});
