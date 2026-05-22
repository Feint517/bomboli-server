import type { Request } from 'express';

export interface AuthenticatedUser {
  id: string;
  email?: string;
  phone?: string;
  /** Admin capability is the only role bit on the user record. Seller and
   *  deliverer capabilities are derived from `SellerProfile` / `Deliverer`
   *  row existence — check those in the relevant services. */
  isAdmin: boolean;
}

export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
  correlationId: string;
}
