import { Injectable } from '@nestjs/common';
import { PrismaService } from '../config/prisma.service';

@Injectable()
export class ReportsService {
    constructor(private readonly prisma: PrismaService) {}

    async inventoryValuation(tenantId: string) {
        const layers = await this.prisma.inventoryCostLayer.findMany({
            where: { tenantId, remainingQty: { gt: 0 } },
            include: { product: true },
            orderBy: [{ productId: 'asc' }, { createdAt: 'asc' }]
        });

        const byProduct = new Map<string, { sku: string; name: string; qty: number; value: number }>();

        for (const l of layers) {
            const key = l.productId;
            const unitCost = Number(l.unitCost);
            const qty = l.remainingQty;
            const value = qty * unitCost;

            const cur = byProduct.get(key);
            if (!cur) {
                byProduct.set(key, { sku: l.product.sku, name: l.product.name, qty, value });
            } else {
                cur.qty += qty;
                cur.value += value;
            }
        }

        const rows = Array.from(byProduct.values()).map((r) => ({
            ...r,
            value: Number(r.value.toFixed(2))
        }));

        const totalValue = rows.reduce((s, r) => s + r.value, 0);

        return { totalValue: Number(totalValue.toFixed(2)), items: rows };
    }

    async salesSummary(tenantId: string, from?: string, to?: string) {
        const fromDate = from ? new Date(from) : new Date('1970-01-01');
        const toDate = to ? new Date(to) : new Date();

        const invoices = await this.prisma.invoice.findMany({
            where: { tenantId, createdAt: { gte: fromDate, lte: toDate } },
            include: { customer: true }
        });

        const cogs = await this.prisma.cogsEntry.findMany({
            where: { tenantId, createdAt: { gte: fromDate, lte: toDate } }
        });

        const revenue = invoices.reduce((s, i) => s + Number(i.total), 0);
        const totalCogs = cogs.reduce((s, c) => s + Number(c.totalCost), 0);
        const grossProfit = revenue - totalCogs;

        return {
            from: fromDate.toISOString().slice(0, 10),
            to: toDate.toISOString().slice(0, 10),
            revenue: Number(revenue.toFixed(2)),
            cogs: Number(totalCogs.toFixed(2)),
            grossProfit: Number(grossProfit.toFixed(2)),
            invoiceCount: invoices.length
        };
    }
}