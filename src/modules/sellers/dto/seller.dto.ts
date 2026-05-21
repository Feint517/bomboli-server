import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const dayWindow = z
  .string()
  .trim()
  .regex(/^\d{1,2}-\d{1,2}$/, 'Format: "HH-HH" (e.g. "9-18")');

const availabilitySchema = z
  .object({
    mon: dayWindow.nullish(),
    tue: dayWindow.nullish(),
    wed: dayWindow.nullish(),
    thu: dayWindow.nullish(),
    fri: dayWindow.nullish(),
    sat: dayWindow.nullish(),
    sun: dayWindow.nullish(),
  })
  .strict();

const latSchema = z.number().min(-90).max(90);
const lngSchema = z.number().min(-180).max(180);

export const UpsertSellerProfileSchema = z
  .object({
    bio: z.string().trim().max(2000).nullish(),
    deliveryRadiusKm: z.number().int().min(1).max(30).optional(),
    availability: availabilitySchema.nullish(),
    languages: z.array(z.string().trim().length(2).toLowerCase()).max(10).optional(),
    pickupPoint: z.object({ lat: latSchema, lng: lngSchema }).nullish(),
    promoText: z.string().trim().max(200).nullish(),
    promoActive: z.boolean().optional(),
    promoExpiresAt: z.string().datetime().nullish(),
  })
  .strict();

export class UpsertSellerProfileDto extends createZodDto(UpsertSellerProfileSchema) {}

export const SellerImageUploadInitSchema = z.object({
  contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  kind: z.enum(['banner', 'hero']),
});

export class SellerImageUploadInitDto extends createZodDto(SellerImageUploadInitSchema) {}
