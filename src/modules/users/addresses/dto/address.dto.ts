import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const latitudeSchema = z.number().min(-90).max(90);
const longitudeSchema = z.number().min(-180).max(180);

const labelSchema = z.string().trim().min(1).max(40);
const formattedSchema = z.string().trim().min(3).max(500);

export const CreateAddressSchema = z.object({
  label: labelSchema,
  formatted: formattedSchema,
  lat: latitudeSchema,
  lng: longitudeSchema,
  gateCode: z.string().trim().max(40).optional(),
  floor: z.string().trim().max(40).optional(),
  deliveryInstructions: z.string().trim().max(500).optional(),
  isDefault: z.boolean().optional(),
});

export class CreateAddressDto extends createZodDto(CreateAddressSchema) {}

export const UpdateAddressSchema = z
  .object({
    label: labelSchema.optional(),
    formatted: formattedSchema.optional(),
    lat: latitudeSchema.optional(),
    lng: longitudeSchema.optional(),
    gateCode: z.string().trim().max(40).nullish(),
    floor: z.string().trim().max(40).nullish(),
    deliveryInstructions: z.string().trim().max(500).nullish(),
  })
  .refine((v) => (v.lat === undefined) === (v.lng === undefined), {
    message: 'lat and lng must be provided together',
  });

export class UpdateAddressDto extends createZodDto(UpdateAddressSchema) {}
