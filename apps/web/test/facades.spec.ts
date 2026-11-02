import type { SceneBuilding } from '@geotoon/contracts';
import { describe, expect, it } from 'vitest';
import { architectureFor } from '../src/scene/architecture.js';
import { extrudePrism } from '../src/scene/extrude.js';
import { buildingFacade, windowStyles } from '../src/scene/facades.js';
import { MeshBuffer } from '../src/scene/mesh-buffer.js';

const house: SceneBuilding = { id: 'house-1', kind: 'house', minHeightM: 0, heightM: 6, heightSource: 'estimated', footprint: [] };

describe('building window styles', () => {
  it('varies neighbouring buildings deterministically without changing their geometry or source', () => {
    const facades = Array.from({ length: 100 }, (_, i) => buildingFacade({ ...house, id: `house-${i}` }));
    expect(buildingFacade(house)).toEqual(buildingFacade(house));
    expect(new Set(facades.map((facade) => facade.variant)).size).toBe(4);
    expect(new Set(facades.map((facade) => facade.seed)).size).toBe(100);
    expect(facades.every((facade) => facade.seed >= 0 && facade.seed < 1)).toBe(true);
    const tall = Array.from({ length: 100 }, (_, i) => buildingFacade({ ...house, id: `tower-${i}`, heightM: 30 }));
    expect(new Set(tall.map((facade) => facade.variant)).size).toBe(5);
    expect(tall.some((facade) => facade.variant === 2)).toBe(true);
  });

  it('uses suitable facade families for offices and industrial buildings', () => {
    for (const kind of ['office', 'commercial']) {
      for (let i = 0; i < 20; i += 1) {
        expect([2, 3, 5]).toContain(buildingFacade({ ...house, id: `office-${i}`, kind }).variant);
      }
    }
    for (const kind of ['warehouse', 'industrial']) {
      expect(buildingFacade({ ...house, kind }).variant).toBe(4);
    }
  });

  it('keeps every window above its floor and adapts six distinct styles to the local profile', () => {
    for (const profile of [architectureFor(), architectureFor({ countryCode: 'BR' }),
      architectureFor({ countryCode: 'BR', city: 'São Paulo' })]) {
      const styles = windowStyles(profile.facade);
      expect(styles).toHaveLength(6);
      expect(new Set(styles.map((style) => style.halfWindowM)).size).toBeGreaterThan(3);
      expect(new Set(styles.map((style) => style.slotM)).size).toBeGreaterThan(3);
      expect(new Set(styles.map((style) => style.mullion))).toEqual(new Set([0, 1, 2]));
      for (const style of styles) {
        expect(style.sillM).toBeGreaterThanOrEqual(0.9);
        expect(style.headM).toBeGreaterThan(style.sillM);
        expect(style.headM + 0.45).toBeLessThan(style.storeyM);
        expect(style.frameM).toBeGreaterThan(0);
      }
    }
  });

  it('carries a separate window-floor datum through buried foundations and elevated building parts', () => {
    for (const [baseY, floorY] of [[-4.2, 1.4], [5.7, 5.7]]) {
      const mesh = new MeshBuffer({ facade: true });
      extrudePrism({ polygons: [[[[0, 0], [0, 12], [12, 12], [12, 0]]]], baseY: baseY!, topY: 17,
        wallColour: [1, 1, 1], roofColour: [1, 1, 1], facadeLayout: [floorY!, 3, 0.25] }, mesh);
      const data = mesh.toMeshData();
      expect(data.facadeLayout).toHaveLength(data.positions.length);
      for (let at = 0; at < data.positions.length; at += 3) {
        if (data.facade![at + 1]! >= 0) {
          expect(data.facadeLayout![at]!).toBeCloseTo(floorY!);
          expect(data.facadeLayout![at + 1]).toBe(3);
          expect(data.facadeLayout![at + 2]).toBeCloseTo(0.25);
        }
      }
    }
  });
});
