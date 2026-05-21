import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const FeedSchema = z
  .object({
    lat: z.coerce.number().min(-90).max(90).optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
    limit: z.coerce.number().int().min(1).max(20).default(10),
  })
  .refine((v) => (v.lat === undefined) === (v.lng === undefined), {
    message: 'lat and lng must be provided together',
  });

export class FeedDto extends createZodDto(FeedSchema) {}
