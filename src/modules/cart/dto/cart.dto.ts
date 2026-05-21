import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const quantitySchema = z.number().int().min(1).max(50);

export const AddCartItemSchema = z.object({
  listingId: z.string().min(1),
  quantity: quantitySchema.default(1),
  options: z.record(z.unknown()).optional(),
});

export class AddCartItemDto extends createZodDto(AddCartItemSchema) {}

export const UpdateCartItemSchema = z.object({
  quantity: quantitySchema,
});

export class UpdateCartItemDto extends createZodDto(UpdateCartItemSchema) {}

/** Replace clears the current cart and adds a single item. The Flutter UI
 *  prompts for confirmation when the user tries to add an item from a different
 *  seller, then calls this to swap. */
export const ReplaceCartSchema = z.object({
  listingId: z.string().min(1),
  quantity: quantitySchema.default(1),
  options: z.record(z.unknown()).optional(),
});

export class ReplaceCartDto extends createZodDto(ReplaceCartSchema) {}
