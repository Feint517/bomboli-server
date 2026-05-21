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

const latSchema = z.number().min(-90).max(90);
const lngSchema = z.number().min(-180).max(180);

export const CreateListingSchema = z.object({
  title: z.string().trim().min(3).max(140),
  description: z.string().trim().min(10).max(5000),
  category: z.enum(CATEGORY_VALUES),
  priceCents: z.number().int().min(0).max(100_000_000),
  currency: z.enum(['CDF', 'USD']).optional(),
  lat: latSchema,
  lng: lngSchema,
  quantityAvailable: z.number().int().min(0).max(10_000).optional(),
  options: z.record(z.unknown()).optional(),
  expiresAt: z.string().datetime().optional(),
});

export class CreateListingDto extends createZodDto(CreateListingSchema) {}

export const UpdateListingSchema = z
  .object({
    title: z.string().trim().min(3).max(140).optional(),
    description: z.string().trim().min(10).max(5000).optional(),
    category: z.enum(CATEGORY_VALUES).optional(),
    priceCents: z.number().int().min(0).max(100_000_000).optional(),
    currency: z.enum(['CDF', 'USD']).optional(),
    lat: latSchema.optional(),
    lng: lngSchema.optional(),
    quantityAvailable: z.number().int().min(0).max(10_000).optional(),
    options: z.record(z.unknown()).nullish(),
    expiresAt: z.string().datetime().nullish(),
  })
  .refine((v) => (v.lat === undefined) === (v.lng === undefined), {
    message: 'lat and lng must be provided together',
  });

export class UpdateListingDto extends createZodDto(UpdateListingSchema) {}

export const InitListingPhotoSchema = z.object({
  contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  alt: z.string().trim().max(140).optional(),
});

export class InitListingPhotoDto extends createZodDto(InitListingPhotoSchema) {}
