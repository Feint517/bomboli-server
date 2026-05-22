import { SetMetadata } from '@nestjs/common';

export const ADMIN_ONLY_KEY = 'bomboli:admin-only';

/**
 * Marks a route as admin-only. The AdminGuard reads this metadata and
 * gates on `req.user.isAdmin === true`. Replaces the old `@Roles(...)`
 * decorator from the multi-value role enum era.
 *
 * Seller and deliverer gating is enforced inside the relevant services
 * (via profile-row existence), not at the route layer.
 */
export const AdminOnly = (): MethodDecorator & ClassDecorator => SetMetadata(ADMIN_ONLY_KEY, true);
