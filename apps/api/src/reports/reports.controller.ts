import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../tenancy/tenant.guard';
import { RbacGuard } from '../rbac/rbac.guard';
import { RequirePerms } from '../rbac/require-perms.decorator';
import { ReportsService } from './reports.service';

@Controller('reports')
@UseGuards(TenantGuard, JwtAuthGuard, RbacGuard)
export class ReportsController {
    constructor(private readonly reports: ReportsService) {}

    @Get('inventory/valuation')
    @RequirePerms('inventory.read')
    inventoryValuation(@Req() req: any) {
        return this.reports.inventoryValuation(req.tenantId);
    }

    @Get('sales/summary')
    @RequirePerms('sales.read')
    salesSummary(
        @Req() req: any,
        @Query('from') from?: string,
        @Query('to') to?: string
    ) {
        return this.reports.salesSummary(req.tenantId, from, to);
    }
}