import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../tenancy/tenant.guard';
import { RbacGuard } from '../rbac/rbac.guard';
import { RequirePerms } from '../rbac/require-perms.decorator';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { CreatePurchaseOrderDto } from './dto/create-po.dto';
import { PurchasingService } from './purchasing.service';

@Controller('purchasing')
@UseGuards(TenantGuard, JwtAuthGuard, RbacGuard)
export class PurchasingController {
    constructor(private readonly purchasing: PurchasingService) {}

    @Post('suppliers')
    @RequirePerms('inventory.write')
    createSupplier(@Req() req: any, @Body() dto: CreateSupplierDto) {
        return this.purchasing.createSupplier(req.tenantId, dto);
    }

    @Get('suppliers')
    @RequirePerms('inventory.read')
    listSuppliers(@Req() req: any) {
        return this.purchasing.listSuppliers(req.tenantId);
    }

    @Post('pos')
    @RequirePerms('inventory.write')
    createPO(@Req() req: any, @Body() dto: CreatePurchaseOrderDto) {
        return this.purchasing.createPO(req.tenantId, dto);
    }

    @Get('pos')
    @RequirePerms('inventory.read')
    listPOs(@Req() req: any) {
        return this.purchasing.listPOs(req.tenantId);
    }

    @Post('pos/:poId/approve')
    @RequirePerms('inventory.write')
    approve(@Req() req: any, @Param('poId') poId: string) {
        return this.purchasing.approvePO(req.tenantId, poId);
    }

    @Post('pos/:poId/receive')
    @RequirePerms('inventory.write')
    receive(@Req() req: any, @Param('poId') poId: string) {
        return this.purchasing.receivePO(req.tenantId, poId);
    }
}