import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** E.164. Bomboli launches in DRC so most numbers will start with +243, but we
 *  don't lock to a country prefix — diaspora and travelers come in too. */
const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{6,14}$/, 'Phone must be in E.164 format (e.g. +243812345678)');

export const SendPhoneOtpSchema = z.object({
  phone: phoneSchema,
});

export class SendPhoneOtpDto extends createZodDto(SendPhoneOtpSchema) {}

export const VerifyPhoneOtpSchema = z.object({
  phone: phoneSchema,
  token: z.string().trim().min(4).max(12),
});

export class VerifyPhoneOtpDto extends createZodDto(VerifyPhoneOtpSchema) {}
