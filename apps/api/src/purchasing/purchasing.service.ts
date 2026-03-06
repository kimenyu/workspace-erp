import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../config/prisma.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { CreatePurchaseOrderDto } from './dto/create-po.dto';
import { FifoService } from '../inventory/fifo.service';


@Injectable()
export class PurchasingService {
    // constructor
    constructor(
        private readonly prisma: PrismaService,
        private readonly fifo: FifoService
    ) {}

    createSupplier(tenantId: string, dto: CreateSupplierDto) {
        return this.prisma.supplier.create({
            data: { tenantId, name: dto.name, email: dto.email, phone: dto.phone }
        });
    }

    listSuppliers(tenantId: string) {
        return this.prisma.supplier.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' } });
    }

    async createPO(tenantId: string, dto: CreatePurchaseOrderDto) {
        const supplier = await this.prisma.supplier.findFirst({
            where: { id: dto.supplierId, tenantId }
        });
        if (!supplier) throw new BadRequestException('Supplier not found');

        // Validate products belong to tenant
        const productIds = dto.lines.map((l) => l.productId);
        const products = await this.prisma.product.findMany({ where: { tenantId, id: { in: productIds } } });
        if (products.length !== productIds.length) throw new BadRequestException('One or more products not found');

        const computedLines = dto.lines.map((l) => {
            const lineTotal = Number(l.qty) * Number(l.unitCost);
            return {
                productId: l.productId,
                name: l.name,
                qty: l.qty,
                unitCost: l.unitCost as any,
                lineTotal: lineTotal as any
            };
        });

        const total = computedLines.reduce((s, l) => s + Number(l.lineTotal), 0);

        return this.prisma.purchaseOrder.create({
            data: {
                tenantId,
                supplierId: dto.supplierId,
                status: 'DRAFT',
                total: total as any,
                lines: { create: computedLines }
            },
            include: { lines: true, supplier: true }
        });
    }

    listPOs(tenantId: string) {
        return this.prisma.purchaseOrder.findMany({
            where: { tenantId },
            include: { supplier: true, lines: true },
            orderBy: { createdAt: 'desc' }
        });
    }

    async approvePO(tenantId: string, poId: string) {
        const po = await this.prisma.purchaseOrder.findFirst({ where: { id: poId, tenantId } });
        if (!po) throw new BadRequestException('PO not found');
        if (po.status !== 'DRAFT') throw new BadRequestException('Only DRAFT POs can be approved');

        return this.prisma.purchaseOrder.update({
            where: { id: poId },
            data: { status: 'APPROVED' }
        });
    }




// method
async receivePO(tenantId: string, poId: string) {
    const po = await this.prisma.purchaseOrder.findFirst({
        where: { id: poId, tenantId },
        include: { lines: true }
    });
    if (!po) throw new BadRequestException('PO not found');
    if (po.status !== 'APPROVED') throw new BadRequestException('Only APPROVED POs can be received');

    // Create stock movements + FIFO layers
    for (const line of po.lines) {
        await this.prisma.stockMovement.create({
            data: {
                tenantId,
                productId: line.productId,
                type: 'IN',
                quantity: line.qty,
                note: `PO_RECEIPT:${po.id}`
            }
        });

        await this.fifo.addCostLayer(
            tenantId,
            line.productId,
            line.qty,
            Number(line.unitCost),
            `PO_RECEIPT:${po.id}`
        );
    }

    return this.prisma.purchaseOrder.update({
        where: { id: poId },
        data: { status: 'RECEIVED' },
        include: { lines: true }
    });
}
}