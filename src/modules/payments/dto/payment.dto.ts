import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{6,14}$/, 'Phone must be in E.164 format (e.g. +243812345678)');

/**
 * Discriminated by `provider`. Each provider may have its own required
 * extras (PayPal needs return/cancel URLs, Pawapay needs phone+operator).
 */
export const CreatePaymentSchema = z
  .object({
    provider: z.enum(['STRIPE', 'PAYPAL', 'PAWAPAY', 'MANUAL']),
    // PayPal
    returnUrl: z.string().url().optional(),
    cancelUrl: z.string().url().optional(),
    // Pawapay
    phone: phoneSchema.optional(),
    operator: z.enum(['VODACOM_MPESA_COD', 'ORANGE_COD', 'AIRTEL_OAPI_COD']).optional(),
  })
  .refine((v) => v.provider !== 'PAYPAL' || (v.returnUrl && v.cancelUrl), {
    message: 'returnUrl and cancelUrl are required for PayPal',
  })
  .refine((v) => v.provider !== 'PAWAPAY' || (v.phone && v.operator), {
    message: 'phone and operator are required for Pawapay',
  });

export class CreatePaymentDto extends createZodDto(CreatePaymentSchema) {}

export const ConfirmPaymentSchema = z.object({
  // Some providers (PayPal) need the client to forward an order id after the
  // user returns from the approval URL.
  providerRef: z.string().optional(),
});

export class ConfirmPaymentDto extends createZodDto(ConfirmPaymentSchema) {}

export const ManualConfirmPaymentSchema = z.object({
  paymentId: z.string().min(1),
  /** Free-form reference: USSD transaction id, cash receipt number, etc. */
  externalRef: z.string().trim().max(200).optional(),
  /** Admin's optional note for the audit log. */
  note: z.string().trim().max(500).optional(),
});

export class ManualConfirmPaymentDto extends createZodDto(ManualConfirmPaymentSchema) {}

export const RefundPaymentSchema = z.object({
  amountCents: z.number().int().min(1).optional(),
  reason: z.string().trim().max(500).optional(),
});

export class RefundPaymentDto extends createZodDto(RefundPaymentSchema) {}
