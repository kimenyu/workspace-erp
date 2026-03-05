import { Controller, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { TenantGuard } from '../../tenancy/tenant.guard';
import { RbacGuard } from '../../rbac/rbac.guard';
import { RequirePerms } from '../../rbac/require-perms.decorator';
import { JobsService } from '../../jobs/jobs.service';
import { UseGuards } from '@nestjs/common';
import { WorkerSecretGuard } from '../../common/guards/worker-secret.guard';

@Controller('google')
@UseGuards(WorkerSecretGuard)
@UseGuards(TenantGuard, JwtAuthGuard, RbacGuard)
export class GoogleController {
    constructor(private readonly jobs: JobsService) {}

    @Post('inventory/export')
    @RequirePerms('inventory.read')
    exportInventory(@Req() req: any) {
        return this.jobs.enqueueInventoryExport({ tenantId: req.tenantId });
    }

    @Post('inventory/schedule-nightly')
    @RequirePerms('inventory.read')
    scheduleNightly(@Req() req: any) {
        return this.jobs.scheduleNightlyInventoryExport(req.tenantId);
    }
}