import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const CATEGORY_VALUES = [
  'COSMETIQUE',
  'TEXTILE',
  'SECONDE_MAIN',
  'AGRICOLE',
  'SERVICES',
  'AUTRES',
] as const;

const SORT_VALUES = ['relevance', 'newest', 'priceAsc', 'priceDesc', 'distance'] as const;

export const SearchSchema = z
  .object({
    q: z.string().trim().max(140).optional(),
    category: z.enum(CATEGORY_VALUES).optional(),
    maxDistanceKm: z.coerce.number().min(0.1).max(30).optional(),
    lat: z.coerce.number().min(-90).max(90).optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
    sort: z.enum(SORT_VALUES).optional(),
    offset: z.coerce.number().int().min(0).max(1000).default(0),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .refine((v) => (v.lat === undefined) === (v.lng === undefined), {
    message: 'lat and lng must be provided together',
  })
  .refine((v) => v.sort !== 'distance' || v.lat !== undefined, {
    message: 'sort=distance requires lat/lng',
  })
  .refine((v) => v.maxDistanceKm === undefined || v.lat !== undefined, {
    message: 'maxDistanceKm requires lat/lng',
  })
  .refine((v) => Boolean(v.q || v.category || v.lat !== undefined), {
    message: 'At least one of q, category, or lat/lng is required',
  });

export class SearchDto extends createZodDto(SearchSchema) {}

export type SortOption = (typeof SORT_VALUES)[number];
