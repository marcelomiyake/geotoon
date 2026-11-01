import { z } from 'zod';

/** `[lon, lat]` in WGS84 degrees (GeoJSON order), rounded to 6 decimals on the wire. */
export const PositionSchema = z.tuple([z.number(), z.number()]);
export const LineCoordsSchema = z.array(PositionSchema);
/** Outer ring first, then holes. */
export const PolygonSchema = z.array(LineCoordsSchema);
export const MultiPolygonSchema = z.array(PolygonSchema);
export const MultiLineSchema = z.array(LineCoordsSchema);

export const LatitudeSchema = z.number().gte(-90).lte(90);
export const LongitudeSchema = z.number().gte(-180).lte(180);

export type Position = z.infer<typeof PositionSchema>;
export type MultiPolygon = z.infer<typeof MultiPolygonSchema>;
export type MultiLine = z.infer<typeof MultiLineSchema>;
