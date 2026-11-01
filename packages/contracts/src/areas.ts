import { z } from 'zod';
import {
  LatitudeSchema,
  LongitudeSchema,
  MultiLineSchema,
  MultiPolygonSchema,
  PositionSchema,
} from './geometry.js';

export const AreaRequestBodySchema = z.strictObject({
  lat: LatitudeSchema,
  lon: LongitudeSchema,
});

export const TileStateSchema = z.enum(['missing', 'fetching', 'complete', 'failed']);

export const TileStatusSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
  state: TileStateSchema,
  fetchedAt: z.string().optional(),
  release: z.string().optional(),
});

export const SceneBuildingSchema = z.object({
  id: z.string(),
  footprint: MultiPolygonSchema,
  heightM: z.number(),
  minHeightM: z.number(),
  heightSource: z.enum(['measured', 'floors', 'estimated']),
  kind: z.string(),
});

/** `kind` is one of the line kinds documented in the README; unknown kinds render as `other`. */
export const SceneLineSchema = z.object({
  id: z.string(),
  kind: z.string(),
  widthM: z.number().positive(),
  name: z.string().optional(),
  coords: MultiLineSchema,
});

export const SceneAreaSchema = z.object({
  id: z.string(),
  kind: z.string(),
  polygons: MultiPolygonSchema,
});

export const SpawnSchema = z.object({
  lon: LongitudeSchema,
  lat: LatitudeSchema,
  headingDeg: z.number(),
});

export const AttributionSchema = z.object({
  text: z.string(),
  url: z.string(),
});

export const TerrainGridSchema = z.object({
  originM: z.number(),
  spacingM: z.number().positive(),
  size: z.number().int().min(2).max(129),
  datumM: z.number(),
  heights: z.array(z.number()).max(129 * 129),
}).refine((grid) => grid.heights.length === grid.size * grid.size, 'Terrain grid dimensions do not match');
export type TerrainGrid = z.infer<typeof TerrainGridSchema>;

export const SceneSchema = z.object({
  buildings: z.array(SceneBuildingSchema),
  lines: z.array(SceneLineSchema),
  areas: z.array(SceneAreaSchema),
  trees: z.array(PositionSchema),
  spawn: SpawnSchema,
  attribution: z.array(AttributionSchema),
  terrain: TerrainGridSchema.optional(),
});

const envelope = {
  contractVersion: z.literal(1),
  requestId: z.string(),
  tiles: z.array(TileStatusSchema),
  sourceCalls: z.number().int().nonnegative(),
};

export const AreaPendingSchema = z.object({
  ...envelope,
  status: z.literal('pending'),
  pollAfterMs: z.number().int().positive(),
});

export const AreaReadySchema = z.object({
  ...envelope,
  status: z.literal('ready'),
  area: z.object({ lat: LatitudeSchema, lon: LongitudeSchema, radiusM: z.number().positive() }),
  scene: SceneSchema,
});

export const AreaResponseSchema = z.discriminatedUnion('status', [
  AreaPendingSchema,
  AreaReadySchema,
]);

export type AreaRequestBody = z.infer<typeof AreaRequestBodySchema>;
export type TileStatus = z.infer<typeof TileStatusSchema>;
export type SceneBuilding = z.infer<typeof SceneBuildingSchema>;
export type SceneLine = z.infer<typeof SceneLineSchema>;
export type SceneArea = z.infer<typeof SceneAreaSchema>;
export type Spawn = z.infer<typeof SpawnSchema>;
export type Attribution = z.infer<typeof AttributionSchema>;
export type Scene = z.infer<typeof SceneSchema>;
export type AreaPending = z.infer<typeof AreaPendingSchema>;
export type AreaReady = z.infer<typeof AreaReadySchema>;
export type AreaResponse = z.infer<typeof AreaResponseSchema>;
