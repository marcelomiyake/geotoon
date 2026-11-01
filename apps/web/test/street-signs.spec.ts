import type { SceneLine } from '@geotoon/contracts';
import { describe, expect, it } from 'vitest';
import { architectureFor } from '../src/scene/architecture.js';
import { CollisionIndex } from '../src/scene/collision.js';
import type { Vec2 } from '../src/scene/mesh-buffer.js';
import { createProjection } from '../src/scene/projection.js';
import { MAX_STREET_SIGNS, buildStreetSigns, streetSignDesign, streetSignText } from '../src/scene/street-signs.js';

const projection = createProjection(0, 0);
function road(points: readonly Vec2[], name = 'Rua São João', kind = 'residential'): SceneLine {
  return { id: name, name, kind, widthM: 6, coords: [points.map(([x, z]) => projection.toGeo(x, z))] };
}

describe('street-name sign placement', () => {
  it('uses actual Unicode names and puts panels on the sidewalk parallel to the street', () => {
    const signs = buildStreetSigns([road([[0, 0], [100, 0]])], projection, 250);
    expect(signs).toHaveLength(2);
    expect(signs[0]).toMatchObject({ name: 'Rua São João', angle: 0 });
    expect(signs[0]!.x).toBeCloseTo(12);
    expect(signs[0]!.z).toBeCloseTo(3.9);
    expect(signs[1]!.x).toBeCloseTo(88);
  });

  it('omits unnamed streets, highways, railways, water, paths and degenerate lines', () => {
    const ordinary = road([[0, 0], [100, 0]]);
    const unnamed: SceneLine = { id: 'unnamed', kind: ordinary.kind, widthM: ordinary.widthM, coords: ordinary.coords };
    const lines = [unnamed, { ...ordinary, name: ' ' }, road([]), road([[0, 0]]), road([[0, 0], [0, 0]]), road([[0, 0], [5, 0]])];
    for (const kind of ['motorway', 'trunk', 'rail', 'stream', 'river', 'footway', 'path', 'other']) {
      lines.push({ ...ordinary, kind });
    }
    expect(buildStreetSigns(lines, projection, 250)).toEqual([]);
  });

  it('handles short blocks, curves, repeated vertices and multiple parts with finite transforms', () => {
    const short = buildStreetSigns([road([[0, 0], [10, 0]])], projection, 250);
    expect(short).toHaveLength(1);
    expect(short[0]!.x).toBeCloseTo(5);
    const curved = road([[0, 0], [0, 0], [0, 100], [400, 100]]);
    const signs = buildStreetSigns([{ ...curved, coords: [...curved.coords, [projection.toGeo(100, -100), projection.toGeo(100, -20)]] }], projection, 1000);
    expect(signs.length).toBeGreaterThan(3);
    expect(signs.some((sign) => Math.abs(sign.angle - Math.PI / 2) < 1e-6)).toBe(true);
    expect(signs.every((sign) => [sign.x, sign.z, sign.angle].every(Number.isFinite))).toBe(true);
  });

  it('deduplicates overlapping segments regardless of API order and avoids crowded signs', () => {
    const a = road([[0, 0], [100, 0]]);
    const b = { ...a, id: 'duplicate', name: ' Rua São João ' };
    const c = road([[0, 0], [100, 0]], 'Rua São José');
    const signs = buildStreetSigns([a, b, c], projection, 250);
    expect(signs).toHaveLength(2);
    expect(buildStreetSigns([c, b, a], projection, 250)).toEqual(signs);
  });

  it('skips panels outside the area or blocked by building walls', () => {
    const line = road([[0, 0], [100, 0]]);
    expect(buildStreetSigns([line], projection, 10)).toEqual([]);
    const collision = new CollisionIndex();
    collision.addEdge(-10, 3, 110, 3);
    expect(buildStreetSigns([line], projection, 250, collision)).toEqual([]);
  });

  it('limits signs and gives the render budget to those nearest the address', () => {
    const lines = Array.from({ length: 160 }, (_, i) => road([[0, i * 15], [100, i * 15]], `Rua ${i}`));
    const signs = buildStreetSigns(lines, projection, 5000);
    expect(signs).toHaveLength(MAX_STREET_SIGNS);
    expect(signs[0]!.name).toBe('Rua 0');
    expect(signs.at(-1)!.z).toBeLessThan(1000);
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
