import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{6,14}$/, 'Phone must be in E.164 format (e.g. +243812345678)');

const latSchema = z.number().min(-90).max(90);
const lngSchema = z.number().min(-180).max(180);

export const CreateDelivererSchema = z.object({
  userId: z.string().min(1),
  vehicleType: z.enum(['MOTO', 'VOITURE', 'VELO', 'A_PIED']),
  /** The deliverer's full phone — server stores last 4 digits as `phoneMasked`. */
  phone: phoneSchema,
});

export class CreateDelivererDto extends createZodDto(CreateDelivererSchema) {}

export const UpdateDelivererLocationSchema = z.object({
  lat: latSchema,
  lng: lngSchema,
});

export class UpdateDelivererLocationDto extends createZodDto(UpdateDelivererLocationSchema) {}

export const UpdateDelivererAvailableSchema = z.object({
  available: z.boolean(),
});

export class UpdateDelivererAvailableDto extends createZodDto(UpdateDelivererAvailableSchema) {}

export const AssignDelivererSchema = z.object({
  delivererId: z.string().min(1),
});

export class AssignDelivererDto extends createZodDto(AssignDelivererSchema) {}
