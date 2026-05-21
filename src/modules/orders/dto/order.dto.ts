import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const FULFILLMENT_VALUES = ['DELIVERY', 'PICKUP'] as const;

export const CreateOrderSchema = z
  .object({
    fulfillmentType: z.enum(FULFILLMENT_VALUES),
    /** Required when `fulfillmentType=DELIVERY` — references an address owned by the caller. */
    addressId: z.string().min(1).optional(),
    /** Delivery fee for the order. Seller-set, passed by the client at checkout. */
    deliveryFeeCents: z.number().int().min(0).max(10_000_000).optional(),
    /** Free-form note attached to the order. */
    note: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.fulfillmentType !== 'DELIVERY' || Boolean(v.addressId), {
    message: 'addressId is required when fulfillmentType=DELIVERY',
  });

export class CreateOrderDto extends createZodDto(CreateOrderSchema) {}

export const ListOrdersSchema = z.object({
  status: z.enum(['PREPARING', 'ON_THE_WAY', 'DELIVERED', 'CANCELLED', 'REFUNDED']).optional(),
  role: z.enum(['buyer', 'seller']).default('buyer'),
  offset: z.coerce.number().int().min(0).max(1000).default(0),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export class ListOrdersDto extends createZodDto(ListOrdersSchema) {}

export const TransitionOrderSchema = z.object({
  to: z.enum(['ON_THE_WAY', 'DELIVERED']),
  etaAt: z.string().datetime().optional(),
});

export class TransitionOrderDto extends createZodDto(TransitionOrderSchema) {}

export const CancelOrderSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

export class CancelOrderDto extends createZodDto(CancelOrderSchema) {}
