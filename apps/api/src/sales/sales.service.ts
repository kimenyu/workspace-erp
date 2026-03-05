import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../config/prisma.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { JobsService } from '../jobs/jobs.service';
import { AccountingService } from '../accounting/accounting.service';
import { FifoService } from '../inventory/fifo.service';

@Injectable()
export class SalesService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly jobs: JobsService,
        private readonly accounting: AccountingService,
        private readonly fifo: FifoService
    ) {}

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
        const inv = await this.prisma.invoice.findFirst({
            where: { id: invoiceId, tenantId },
            include: { lines: true }
        });
        if (!inv) throw new BadRequestException('Invoice not found');
        if (inv.status !== 'DRAFT') throw new BadRequestException('Only DRAFT invoices can be sent');

        // 1) Update invoice status
        const updated = await this.prisma.invoice.update({
            where: { id: invoiceId },
            data: { status: 'SENT' },
            include: { lines: true }
        });

        // 2) Inventory + FIFO COGS (only for lines linked to products)
        for (const line of updated.lines) {
            if (!line.productId) continue;

            await this.prisma.stockMovement.create({
                data: {
                    tenantId,
                    productId: line.productId,
                    type: 'OUT',
                    quantity: line.qty,
                    note: `INVOICE:${invoiceId}`
                }
            });

            await this.fifo.consumeForInvoiceLine({
                tenantId,
                invoiceId,
                productId: line.productId,
                qty: line.qty
            });
        }

        // 3) Enqueue Google invoice send job
        await this.jobs.enqueueInvoiceSend({ tenantId, invoiceId });

        return updated;
    }


// method
async createPayment(tenantId: string, invoiceId: string, amount: number, method: string) {
    const inv = await this.prisma.invoice.findFirst({ where: { id: invoiceId, tenantId } });
    if (!inv) throw new BadRequestException('Invoice not found');

    const payment = await this.prisma.payment.create({
        data: {
            invoiceId,
            amount: amount as any,
            method
        }
    });

    await this.accounting.postInvoicePaymentEntry(tenantId, invoiceId, payment.id, amount);

    // Optional: mark paid if totals match
    const paidSum = await this.prisma.payment.aggregate({
        where: { invoiceId },
        _sum: { amount: true }
    });

    const totalPaid = Number(paidSum._sum.amount ?? 0);
    if (totalPaid >= Number(inv.total)) {
        await this.prisma.invoice.update({
            where: { id: invoiceId },
            data: { status: 'PAID' }
        });
    }

    return payment;
}
}