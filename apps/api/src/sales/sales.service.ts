import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../config/prisma.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { CreateInvoiceDto } from './dto/create-invoice.dto';

@Injectable()
export class SalesService {
    constructor(private readonly prisma: PrismaService) {}

    createCustomer(tenantId: string, dto: CreateCustomerDto) {
        return this.prisma.customer.create({
            data: {
                tenantId,
                name: dto.name,
                email: dto.email,
                phone: dto.phone
            }
        });
    }

    listCustomers(tenantId: string) {
        return this.prisma.customer.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' } });
    }

    async createInvoice(tenantId: string, dto: CreateInvoiceDto) {
        const customer = await this.prisma.customer.findFirst({
            where: { id: dto.customerId, tenantId }
        });
        if (!customer) throw new BadRequestException('Customer not found');

        const computedLines = dto.lines.map((l) => {
            const lineTotal = Number(l.qty) * Number(l.unitPrice);
            return {
                productId: l.productId ?? null,
                name: l.name,
                qty: l.qty,
                unitPrice: l.unitPrice as any,
                lineTotal: lineTotal as any
            };
        });

        const total = computedLines.reduce((s, l) => s + Number(l.lineTotal), 0);

        return this.prisma.invoice.create({
            data: {
                tenantId,
                customerId: dto.customerId,
                status: 'DRAFT',
                total: total as any,
                lines: { create: computedLines }
            },
            include: { lines: true, customer: true }
        });
    }

    listInvoices(tenantId: string) {
        return this.prisma.invoice.findMany({
            where: { tenantId },
            include: { customer: true, lines: true },
            orderBy: { createdAt: 'desc' }
        });
    }

    async markInvoiceSent(tenantId: string, invoiceId: string) {
        const inv = await this.prisma.invoice.findFirst({ where: { id: invoiceId, tenantId } });
        if (!inv) throw new BadRequestException('Invoice not found');

        return this.prisma.invoice.update({
            where: { id: invoiceId },
            data: { status: 'SENT' }
        });
    }
}