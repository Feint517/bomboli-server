import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { ROLES_KEY } from '@common/decorators/roles.decorator';
import { UserRole } from '@common/enums/user-role.enum';
import type { AuthenticatedRequest } from '@common/types/authenticated-request.type';

/**
 * Role-gating guard. Runs after JwtAuthGuard, so `request.user.role` is
 * already the DB-truth value resolved by SupabaseJwtStrategy (which always
 * reads the local User row, either via lookup or JIT provisioning).
 *
 * If a handler has no `@Roles(...)` decorator, the guard passes through —
 * the DB lookup that older code did per-request is no longer needed.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user) {
      throw new ForbiddenException('Authentication required');
    }

    if (!required.includes(request.user.role)) {
      throw new ForbiddenException(`Requires role: ${required.join(', ')}`);
    }

    return true;
  }
}
