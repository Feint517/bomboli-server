import { SetMetadata } from '@nestjs/common';

export const AUDITED_METADATA_KEY = 'bomboli:audited';

export interface AuditedOptions {
  /** Free-form action name, e.g. `"seller.verification.update"`. */
  action: string;
  /** Resource type label (e.g. `"Seller"`, `"Order"`). */
  resourceType?: string;
  /** Path on the request to read the resource id from. Default: `params.id`. */
  resourceIdFrom?: 'params.id' | 'body.id' | 'response.id';
}

/**
 * Marks a route handler as auditable. The AuditInterceptor reads this
 * metadata and writes a row to AuditLog on successful response. Use on
 * admin actions and other sensitive operations.
 */
export const Audited = (options: AuditedOptions | string): MethodDecorator =>
  SetMetadata(AUDITED_METADATA_KEY, typeof options === 'string' ? { action: options } : options);
