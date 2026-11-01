import { AreaReadySchema, type SceneBuilding } from '@geotoon/contracts';
import { describe, expect, it } from 'vitest';
import recorded from '../../../fixtures/scene/poc-scene.json' with { type: 'json' };
import { architectureFor, buildingAppearance } from '../src/scene/architecture.js';
import { MeshBuffer } from '../src/scene/mesh-buffer.js';
import { extrudePrism } from '../src/scene/extrude.js';
import { buildScene } from '../src/scene/scene-builder.js';

const ready = AreaReadySchema.parse(recorded);
const house: SceneBuilding = { id: 'house-1', kind: 'house', minHeightM: 0, heightM: 6, heightSource: 'estimated', footprint: [] };

describe('local architecture profiles', () => {
  it('resolves city, country and original fallback without guessing from coordinates', () => {
    expect(architectureFor().id).toBe('default');
    expect(architectureFor({ countryCode: 'JP', city: 'São Paulo' }).id).toBe('default');
    expect(architectureFor({ countryCode: 'BR' }).id).toBe('BR');
    expect(architectureFor({ countryCode: 'BR', city: 'Recife' }).id).toBe('BR');
    expect(architectureFor({ countryCode: 'BR', city: ' São PAULO ' }).id).toBe('BR/sao-paulo');
    expect(architectureFor({ countryCode: 'BR', city: 'Sao Paulo' }).id).toBe('BR/sao-paulo');
  });

  it('mixes slabs and clay roofs deterministically while keeping large building kinds flat', () => {
    const style = architectureFor({ countryCode: 'BR' });
    const appearances = Array.from({ length: 200 }, (_, i) => buildingAppearance({ ...house, id: `house-${i}` }, style));
    const pitchedCount = appearances.filter((appearance) => appearance.pitched).length;
    expect(pitchedCount).toBeGreaterThan(90);
    expect(pitchedCount).toBeLessThan(160);
    expect(buildingAppearance(house, style)).toEqual(buildingAppearance(house, style));
    for (const appearance of appearances) {
      expect(style.palette.walls).toContainEqual(appearance.colours.wall);
      expect(style.palette.tiles).toContainEqual(appearance.colours.tile);
    }
    for (const kind of ['apartments', 'office', 'warehouse', 'school', 'hospital']) {
      expect(buildingAppearance({ ...house, kind }, style).pitched).toBe(false);
    }
    expect(buildingAppearance({ ...house, minHeightM: 3 }, style).pitched).toBe(false);
    expect(buildingAppearance(house, architectureFor()).pitched).toBe(true);
  });

  it('changes window geometry slots and facade proportions with the profile', () => {
    const style = architectureFor({ countryCode: 'BR', city: 'São Paulo' });
    expect(style.facade.halfWindowM).toBeGreaterThan(architectureFor().facade.halfWindowM);
    const mesh = new MeshBuffer({ facade: true });
    extrudePrism({ polygons: [[[[0, 0], [0, 12], [12, 12], [12, 0]]]], baseY: 0, topY: 6,
      wallColour: [1, 1, 1], roofColour: [1, 1, 1], windowSlotM: style.facade.slotM }, mesh);
    expect(mesh.toMeshData().facade![3]).toBe(4);
  });

  it('applies locality to a complete recorded scene while preserving map counts and collision walls', () => {
    const fallback = buildScene(ready.scene, ready.area);
    const local = buildScene(ready.scene, { ...ready.area, locality: { countryCode: 'BR', city: 'São Paulo' } });
    expect(local.architecture.id).toBe('BR/sao-paulo');
    expect(local.buildings[0]?.colors).not.toEqual(fallback.buildings[0]?.colors);
    expect(local.stats.buildings).toBe(fallback.stats.buildings);
    expect(local.stats.collisionEdges).toBe(fallback.stats.collisionEdges);
    expect(local.streetSigns.length).toBeGreaterThan(0);
    expect(local.stats.streetSigns).toBe(local.streetSigns.length);
    const names = new Set(ready.scene.lines.map((line) => line.name));
    expect(local.streetSigns.every((sign) => sign.panels.every((panel) => names.has(panel.name)))).toBe(true);
  });
});
