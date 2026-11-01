import { CONTRACT_VERSION, type AreaPending, type AreaReady, type TileStatus } from '@geotoon/contracts';
import type { AreaResult, GeoPoint, Scene, TileStatusView } from '@geotoon/core';

/** Lets readonly domain values be checked against the (mutable) inferred wire types. */
export type DeepReadonly<T> = T extends (infer U)[]
  ? readonly DeepReadonly<U>[]
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

export const POLL_AFTER_MS = 2000;

export function toTileStatus(view: TileStatusView): TileStatus {
  const status: TileStatus = { x: view.tile.x, y: view.tile.y, state: view.state };
  if (view.fetchedAt !== undefined) {
    status.fetchedAt = view.fetchedAt.toISOString();
  }
  if (view.release !== undefined) {
    status.release = view.release;
  }
  return status;
}

export function toWireScene(scene: Scene): DeepReadonly<AreaReady['scene']> {
  return {
    buildings: scene.buildings.map((b) => ({
      id: b.id,
      footprint: b.footprint,
      heightM: b.heightM,
      minHeightM: b.minHeightM,
      heightSource: b.heightSource,
      kind: b.kind,
    })),
    lines: scene.lines.map((l) => ({
      id: l.id,
      kind: l.kind,
      widthM: l.widthM,
      ...(l.name === undefined ? {} : { name: l.name }),
      coords: l.coords,
    })),
    areas: scene.areas.map((a) => ({ id: a.id, kind: a.kind, polygons: a.polygons })),
    trees: scene.trees,
    spawn: {
      lon: scene.spawn.position[0],
      lat: scene.spawn.position[1],
      headingDeg: scene.spawn.headingDeg,
    },
    attribution: scene.attribution.map((a) => ({ text: a.text, url: a.url })),
  };
}

export type AreaBody = DeepReadonly<AreaPending> | DeepReadonly<AreaReady>;

/** Maps the use-case result to the `/api/v1/areas` response body. */
export function toAreaBody(
  result: AreaResult,
  centre: GeoPoint,
  radiusM: number,
  requestId: string,
): AreaBody {
  const envelope = {
    contractVersion: CONTRACT_VERSION,
    requestId,
    tiles: result.tiles.map(toTileStatus),
    sourceCalls: result.sourceCalls,
  } as const;
  if (result.status === 'pending') {
    return { ...envelope, status: 'pending', pollAfterMs: POLL_AFTER_MS };
  }
  return {
    ...envelope,
    status: 'ready',
    area: { lat: centre.lat, lon: centre.lon, radiusM },
    scene: toWireScene(result.scene),
  };
}
