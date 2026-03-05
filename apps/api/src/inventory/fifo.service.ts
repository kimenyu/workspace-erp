import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../config/prisma.service';

@Injectable()
export class FifoService {
    constructor(private readonly prisma: PrismaService) {}

    /**
     * Add a FIFO layer when stock is received (e.g., from PO).
     */
    addCostLayer(tenantId: string, productId: string, qty: number, unitCost: number, source: string) {
        if (qty <= 0) throw new BadRequestException('qty must be > 0');
        if (unitCost < 0) throw new BadRequestException('unitCost must be >= 0');

        return this.prisma.inventoryCostLayer.create({
            data: {
                tenantId,
                productId,
                remainingQty: qty,
                unitCost: unitCost as any,
                source
            }
        });
    }

    /**
     * Consume FIFO layers for a sale and record COGS entries.
     * Throws if insufficient stock layers (i.e. negative inventory not allowed).
     */
    async consumeForInvoiceLine(args: {
        tenantId: string;
        invoiceId: string;
        productId: string;
        qty: number;
    }) {
        const { tenantId, invoiceId, productId } = args;
        let qtyToConsume = args.qty;

        if (qtyToConsume <= 0) return [];

        const layers = await this.prisma.inventoryCostLayer.findMany({
            where: { tenantId, productId, remainingQty: { gt: 0 } },
            orderBy: { createdAt: 'asc' }
        });

        const available = layers.reduce((s, l) => s + l.remainingQty, 0);
        if (available < qtyToConsume) throw new BadRequestException('Insufficient FIFO stock layers for sale');

        const cogs: any[] = [];

        for (const layer of layers) {
            if (qtyToConsume === 0) break;

            const take = Math.min(qtyToConsume, layer.remainingQty);
            qtyToConsume -= take;

            // decrement layer
            await this.prisma.inventoryCostLayer.update({
                where: { id: layer.id },
                data: { remainingQty: layer.remainingQty - take }
            });

            const unitCost = Number(layer.unitCost);
            const totalCost = take * unitCost;

            cogs.push(
                await this.prisma.cogsEntry.create({
                    data: {
                        tenantId,
                        invoiceId,
                        productId,
                        qty: take,
                        unitCost: unitCost as any,
                        totalCost: totalCost as any
                    }
                })
            );
        }

        return cogs;
    }
}