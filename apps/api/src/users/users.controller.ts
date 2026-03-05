import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { PrismaService } from '../config/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../tenancy/tenant.guard';
import { RbacGuard } from '../rbac/rbac.guard';
import { RequirePerms } from '../rbac/require-perms.decorator';

@Controller('users')
@UseGuards(TenantGuard, JwtAuthGuard, RbacGuard)
export class UsersController {
    constructor(private readonly prisma: PrismaService) {}

    @Get('me')
    me(@Req() req: any) {
        return { user: req.user, tenantId: req.tenantId };
    }

    @Get()
    @RequirePerms('users.read')
    async list(@Req() req: any) {
        const tenantId = req.tenantId as string;
        const rows = await this.prisma.userTenant.findMany({
            where: { tenantId },
            include: { user: true, role: true }
        });

        return rows.map((r) => ({
            userId: r.userId,
            email: r.user.email,
            fullName: r.user.fullName,
            role: r.role?.name ?? null
        }));
    }
}