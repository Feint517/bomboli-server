import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{6,14}$/, 'Phone must be in E.164 format (e.g. +243812345678)');

const emailSchema = z.string().trim().toLowerCase().email();

// Pilot policy: at least 8 chars, at least one letter and one digit. Supabase
// also enforces its own minimums; ours is the friendlier reject ahead of time.
const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password too long')
  .regex(/[A-Za-z]/, 'Password must contain a letter')
  .regex(/\d/, 'Password must contain a digit');

export const SignupSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: z.string().trim().min(1).max(120).optional(),
  phone: phoneSchema.optional(),
});

export class SignupDto extends createZodDto(SignupSchema) {}

export const LoginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(72),
});

export class LoginDto extends createZodDto(LoginSchema) {}

export const RefreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export class RefreshDto extends createZodDto(RefreshSchema) {}

export const VerifyEmailSchema = z.object({
  email: emailSchema,
  token: z.string().trim().min(4).max(12),
});

export class VerifyEmailDto extends createZodDto(VerifyEmailSchema) {}

export const ResendVerificationSchema = z.object({
  email: emailSchema,
});

export class ResendVerificationDto extends createZodDto(ResendVerificationSchema) {}

export const PasswordResetRequestSchema = z.object({
  email: emailSchema,
});

export class PasswordResetRequestDto extends createZodDto(PasswordResetRequestSchema) {}

export const PasswordResetSchema = z.object({
  email: emailSchema,
  token: z.string().trim().min(4).max(12),
  newPassword: passwordSchema,
});

export class PasswordResetDto extends createZodDto(PasswordResetSchema) {}

export const OAuthExchangeSchema = z.object({
  provider: z.enum(['google', 'apple']),
  idToken: z.string().min(20),
  // Apple requires nonce for replay protection; Google supports it.
  nonce: z.string().optional(),
  // Apple Sign In can also return an authorization code we don't use yet;
  // we accept it so the client can send a single payload shape.
  accessToken: z.string().optional(),
});

export class OAuthExchangeDto extends createZodDto(OAuthExchangeSchema) {}
