import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../tenancy/tenant.guard';
import { RbacGuard } from '../rbac/rbac.guard';
import { RequirePerms } from '../rbac/require-perms.decorator';
import { InventoryService } from './inventory.service';
import { CreateProductDto } from './dto/create-product.dto';
import { StockMoveDto } from './dto/stock-move.dto';

@Controller('inventory')
@UseGuards(TenantGuard, JwtAuthGuard, RbacGuard)
export class InventoryController {
    constructor(private readonly inv: InventoryService) {}

    @Post('products')
    @RequirePerms('inventory.write')
    createProduct(@Req() req: any, @Body() dto: CreateProductDto) {
        return this.inv.createProduct(req.tenantId, dto);
    }

    @Get('products')
    @RequirePerms('inventory.read')
    listProducts(@Req() req: any) {
        return this.inv.listProducts(req.tenantId);
    }

    @Post('stock/move')
    @RequirePerms('inventory.write')
    moveStock(@Req() req: any, @Body() dto: StockMoveDto) {
        return this.inv.moveStock(req.tenantId, dto);
    }

    @Get('stock/:productId')
    @RequirePerms('inventory.read')
    stock(@Req() req: any, @Param('productId') productId: string) {
        return this.inv.getStockLevel(req.tenantId, productId);
    }
}