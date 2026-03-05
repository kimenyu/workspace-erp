import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../tenancy/tenant.guard';
import { RbacGuard } from '../rbac/rbac.guard';
import { RequirePerms } from '../rbac/require-perms.decorator';
import { SalesService } from './sales.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { CreateInvoiceDto } from './dto/create-invoice.dto';

@Controller('sales')
@UseGuards(TenantGuard, JwtAuthGuard, RbacGuard)
export class SalesController {
    constructor(private readonly sales: SalesService) {}

    @Post('customers')
    @RequirePerms('sales.write')
    createCustomer(@Req() req: any, @Body() dto: CreateCustomerDto) {
        return this.sales.createCustomer(req.tenantId, dto);
    }

    @Get('customers')
    @RequirePerms('sales.read')
    listCustomers(@Req() req: any) {
        return this.sales.listCustomers(req.tenantId);
    }

    @Post('invoices')
    @RequirePerms('sales.write')
    createInvoice(@Req() req: any, @Body() dto: CreateInvoiceDto) {
        return this.sales.createInvoice(req.tenantId, dto);
    }

    @Get('invoices')
    @RequirePerms('sales.read')
    listInvoices(@Req() req: any) {
        return this.sales.listInvoices(req.tenantId);
    }

    @Post('invoices/:invoiceId/sent')
    @RequirePerms('sales.write')
    markSent(@Req() req: any, @Param('invoiceId') invoiceId: string) {
        return this.sales.markInvoiceSent(req.tenantId, invoiceId);
    }
}