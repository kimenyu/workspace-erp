import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../config/prisma.service';
import { REQUIRE_PERMS_KEY } from './require-perms.decorator';

@Injectable()
export class RbacGuard implements CanActivate {
    constructor(
        private readonly reflector: Reflector,
        private readonly prisma: PrismaService
    ) {}

    async canActivate(ctx: ExecutionContext): Promise<boolean> {
        const required = this.reflector.getAllAndOverride<string[]>(REQUIRE_PERMS_KEY, [
            ctx.getHandler(),
            ctx.getClass()
        ]);

        if (!required || required.length === 0) return true;

        const req = ctx.switchToHttp().getRequest();
        const tenantId = req.tenantId as string | undefined;
        const user = req.user as { sub: string; email: string } | undefined;

        if (!tenantId) throw new ForbiddenException('Missing tenant');
        if (!user?.sub) throw new ForbiddenException('Missing user');

        const ut = await this.prisma.userTenant.findUnique({
            where: { userId_tenantId: { userId: user.sub, tenantId } },
            include: {
                role: { include: { perms: { include: { permission: true } } } }
            }
        });

        if (!ut?.role) throw new ForbiddenException('No role assigned');

        const keys = new Set(ut.role.perms.map((rp) => rp.permission.key));
        const ok = required.every((k) => keys.has(k));
        if (!ok) throw new ForbiddenException('Insufficient permissions');

        return true;
    }
}