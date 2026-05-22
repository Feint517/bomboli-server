import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { ADMIN_ONLY_KEY } from '@common/decorators/roles.decorator';
import type { AuthenticatedRequest } from '@common/types/authenticated-request.type';

/**
 * Admin gate. Runs after JwtAuthGuard, so `request.user.isAdmin` is
 * already populated by SupabaseJwtStrategy from the local DB. Handlers
 * without an `@AdminOnly()` decorator pass through.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const adminOnly = this.reflector.getAllAndOverride<boolean | undefined>(ADMIN_ONLY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!adminOnly) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user) throw new ForbiddenException('Authentication required');
    if (!request.user.isAdmin) throw new ForbiddenException('Admin only');
    return true;
  }
}
