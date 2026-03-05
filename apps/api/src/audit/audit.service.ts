import { Injectable } from '@nestjs/common';
import { PrismaService } from '../config/prisma.service';

@Injectable()
export class AuditService {
    constructor(private readonly prisma: PrismaService) {}

    async log(input: {
        tenantId: string;
        actorId?: string;
        action: string;
        entity: string;
        entityId?: string;
        metadata?: Record<string, any>;
    }) {
        return this.prisma.auditLog.create({
            data: {
                tenantId: input.tenantId,
                actorId: input.actorId,
                action: input.action,
                entity: input.entity,
                entityId: input.entityId,
                metadata: input.metadata ?? undefined
            }
        });
    }
}