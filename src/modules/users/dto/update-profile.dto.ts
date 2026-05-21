import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const latitudeSchema = z.number().min(-90).max(90);
const longitudeSchema = z.number().min(-180).max(180);

export const UpdateProfileSchema = z
  .object({
    displayName: z.string().trim().min(1).max(120).nullish(),
    preferredLanguage: z.enum(['fr', 'en']).optional(),
    themePref: z.enum(['system', 'light', 'dark']).optional(),
    defaultLocation: z.object({ lat: latitudeSchema, lng: longitudeSchema }).nullish(),
  })
  .strict();

export class UpdateProfileDto extends createZodDto(UpdateProfileSchema) {}

export const AvatarUploadInitSchema = z.object({
  /** Allow only common image MIME types — clients should resize before upload. */
  contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
});

export class AvatarUploadInitDto extends createZodDto(AvatarUploadInitSchema) {}
