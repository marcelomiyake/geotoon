import { describe, expect, it } from 'vitest';
import type { MapLine, PolygonCoords, StoredBuilding } from '../src/cartography/domain/features.js';
import { surfaceBuildings } from '../src/cartography/domain/surface-buildings.js';
import recorded from '../../../fixtures/scene/paulista-underpass.json' with { type: 'json' };

const square: PolygonCoords = [[[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]]];
const station: StoredBuilding = { id: 'station', kind: 'transportation', footprint: [square] };
const road: MapLine = { id: 'street', kind: 'primary', coords: [[[-20, 5], [20, 5]]] };

describe('transportation footprints over mapped streets', () => {
  it('clears the recorded Paulista/Consolação station footprints that blocked the Fanganiello crossing', () => {
    const buildings: StoredBuilding[] = recorded.buildings.map((building) => ({ ...building,
      footprint: building.footprint.map((polygon) => polygon.map((ring) => ring.map(([lon, lat]) => [lon!, lat!] as const))) }));
    const lines: MapLine[] = recorded.lines.map((line) => ({ ...line, kind: line.kind === 'primary' ? 'primary' : 'residential',
      coords: line.coords.map((part) => part.map(([lon, lat]) => [lon!, lat!] as const)) }));
    expect(buildings).toHaveLength(2);
    expect(surfaceBuildings(buildings, lines)).toEqual([]);
  });
  it('does not invent a solid building across a road from an unmeasured station footprint', () => {
    expect(surfaceBuildings([station], [road])).toEqual([]);
    expect(surfaceBuildings([station], [{ ...road, coords: [[[2, 2], [8, 8]]] }])).toEqual([]);
  });

  it('retains real measured structures, raised parts, ordinary buildings and unrelated transportation buildings', () => {
    const buildings = [{ ...station, sourceHeightM: 12 }, { ...station, numFloors: 2 },
      { ...station, minHeightM: 8 }, { ...station, kind: 'apartments' }];
    expect(surfaceBuildings(buildings, [road])).toEqual(buildings);
    expect(surfaceBuildings([station], [{ ...road, coords: [[[-20, 20], [20, 20]]] }])).toEqual([station]);
    expect(surfaceBuildings([station], [{ ...road, kind: 'footway' }])).toEqual([station]);
    expect(surfaceBuildings([station], [])).toEqual([station]);
    expect(surfaceBuildings([{ ...station, footprint: [] }], [road])).toHaveLength(1);
  });

  it('preserves courtyard openings and does not confuse nearby, tangent or degenerate roads with interior crossings', () => {
    const courtyard: PolygonCoords = [...square, [[2, 2], [8, 2], [8, 8], [2, 8], [2, 2]]];
    const building = { ...station, footprint: [courtyard] };
    expect(surfaceBuildings([building], [{ ...road, coords: [[[3, 5], [7, 5]]] }])).toEqual([building]);
    expect(surfaceBuildings([station], [{ ...road, coords: [[[-10, -1], [20, -1]]] }])).toEqual([station]);
    expect(surfaceBuildings([station], [{ ...road, coords: [[[-10, 0], [20, 0]]] }])).toEqual([station]);
    expect(surfaceBuildings([station], [{ ...road, coords: [[], [[-1, -1]], [[-2, -2], [-2, -2]]] }])).toEqual([station]);
    expect(surfaceBuildings([building], [road])).toEqual([]);
  });
});
