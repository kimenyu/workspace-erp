import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { AuditService } from './audit.service';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
    constructor(private readonly audit: AuditService) {}

    intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
        const req = context.switchToHttp().getRequest();
        const tenantId = req.tenantId as string | undefined;
        const user = req.user as { sub: string } | undefined;

        // We only auto-log mutating methods
        const method = String(req.method || '').toUpperCase();
        const should = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);

        return next.handle().pipe(
            tap(async (result) => {
                if (!should) return;
                if (!tenantId) return;

                const entity = (context.getClass()?.name ?? 'Unknown').replace('Controller', '');
                await this.audit.log({
                    tenantId,
                    actorId: user?.sub,
                    action: method,
                    entity,
                    entityId: result?.id ? String(result.id) : undefined,
                    metadata: {
                        path: req.originalUrl,
                        bodyKeys: req.body ? Object.keys(req.body) : []
                    }
                }).catch(() => undefined);
            })
        );
    }
}