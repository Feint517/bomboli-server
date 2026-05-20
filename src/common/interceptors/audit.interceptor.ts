import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, tap } from 'rxjs';

import { AUDITED_METADATA_KEY, AuditedOptions } from '@common/decorators/audited.decorator';
import type { AuthenticatedRequest } from '@common/types/authenticated-request.type';

import { AuditService } from '@infrastructure/audit/audit.service';

type AuditableRequest = Partial<AuthenticatedRequest> & {
  params?: Record<string, unknown>;
  body?: unknown;
  headers: Record<string, unknown>;
  ip?: string;
  socket?: { remoteAddress?: string };
};

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const options = this.reflector.getAllAndOverride<AuditedOptions | undefined>(
      AUDITED_METADATA_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!options) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<AuditableRequest>();
    const actorId = request.user?.id;
    const ipAddress = request.ip ?? request.socket?.remoteAddress ?? null;
    const userAgent = (request.headers['user-agent'] as string | undefined) ?? null;
    const correlationId = request.correlationId ?? null;

    return next.handle().pipe(
      tap((response) => {
        const resourceId = this.extractResourceId(options, request, response);
        // Fire-and-forget; AuditService swallows errors.
        void this.audit.record({
          actorId,
          action: options.action,
          resourceType: options.resourceType ?? null,
          resourceId,
          ipAddress,
          userAgent,
          correlationId,
        });
      }),
    );
  }

  private extractResourceId(
    options: AuditedOptions,
    request: AuditableRequest,
    response: unknown,
  ): string | null {
    const source = options.resourceIdFrom ?? 'params.id';
    switch (source) {
      case 'params.id':
        return (request.params?.id as string | undefined) ?? null;
      case 'body.id':
        return ((request.body as Record<string, unknown> | undefined)?.id as string) ?? null;
      case 'response.id':
        return ((response as Record<string, unknown> | undefined)?.id as string) ?? null;
      default:
        return null;
    }
  }
}
