import { z } from 'zod';
import { LatitudeSchema, LongitudeSchema } from './geometry.js';

export const GeocodeQuerySchema = z.object({
  q: z.string().min(1).max(200),
  lat: z.coerce.number().pipe(LatitudeSchema).optional(),
  lon: z.coerce.number().pipe(LongitudeSchema).optional(),
});

export const LocalitySchema = z.object({
  countryCode: z.string().regex(/^[A-Z]{2}$/),
  city: z.string().trim().min(1).max(120).optional(),
});

export type Locality = z.infer<typeof LocalitySchema>;

export const SuggestionSchema = z.object({
  id: z.string(),
  label: z.string(),
  lat: LatitudeSchema,
  lon: LongitudeSchema,
  kind: z.enum(['house', 'street', 'place', 'other']),
  locality: LocalitySchema.optional(),
});

export const GeocodeResponseSchema = z.object({
  suggestions: z.array(SuggestionSchema),
});

export type GeocodeQuery = z.infer<typeof GeocodeQuerySchema>;
export type Suggestion = z.infer<typeof SuggestionSchema>;
export type GeocodeResponse = z.infer<typeof GeocodeResponseSchema>;
