import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';

import { MetricsService } from '@infrastructure/observability/metrics.service';

import type { Request, Response } from 'express';

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const endTimer = this.metrics.httpRequestDurationSeconds.startTimer({
      method: request.method,
      route: this.routeLabel(request),
    });

    return next.handle().pipe(
      tap({
        next: () => this.record(request, response.statusCode, endTimer),
        error: (err: unknown) => {
          const status =
            typeof (err as { status?: number })?.status === 'number'
              ? (err as { status: number }).status
              : 500;
          this.record(request, status, endTimer);
        },
      }),
    );
  }

  private record(
    request: Request,
    status: number,
    endTimer: (labels?: Record<string, string | number>) => void,
  ): void {
    const labels = {
      method: request.method,
      route: this.routeLabel(request),
      status: String(status),
    };
    this.metrics.httpRequestsTotal.inc(labels);
    endTimer({ status: String(status) });
  }

  private routeLabel(request: Request): string {
    // Express's route.path (e.g. '/users/:id') keeps cardinality low.
    return (request.route?.path as string | undefined) ?? request.path;
  }
}
