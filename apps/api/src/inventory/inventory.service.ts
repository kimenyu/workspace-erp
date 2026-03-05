import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../config/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { StockMoveDto, StockMoveType } from './dto/stock-move.dto';

@Injectable()
export class InventoryService {
    constructor(private readonly prisma: PrismaService) {}

    createProduct(tenantId: string, dto: CreateProductDto) {
        return this.prisma.product.create({
            data: {
                tenantId,
                sku: dto.sku,
                name: dto.name,
                price: dto.price as any
            }
        });
    }

    listProducts(tenantId: string) {
        return this.prisma.product.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' } });
    }

    async moveStock(tenantId: string, dto: StockMoveDto) {
        const product = await this.prisma.product.findFirst({
            where: { id: dto.productId, tenantId }
        });
        if (!product) throw new BadRequestException('Product not found');

        // In a real ERP you’d keep a stock table; for v1 we compute from movements.
        const movement = await this.prisma.stockMovement.create({
            data: {
                tenantId,
                productId: dto.productId,
                type: dto.type as any,
                quantity: dto.quantity,
                note: dto.note
            }
        });

        return movement;
    }

    async getStockLevel(tenantId: string, productId: string) {
        const moves = await this.prisma.stockMovement.findMany({ where: { tenantId, productId } });

        let stock = 0;
        for (const m of moves) {
            if (m.type === StockMoveType.IN) stock += m.quantity;
            if (m.type === StockMoveType.OUT) stock -= m.quantity;
            if (m.type === StockMoveType.ADJUST) stock = m.quantity; // interpret as absolute set
        }

        return { productId, stock };
    }
}