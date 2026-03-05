import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../config/prisma.service';
import { ensureDefaultAccounts } from './accounting.seed';

@Injectable()
export class AccountingService {
    constructor(private readonly prisma: PrismaService) {}

    async postInvoicePaymentEntry(tenantId: string, invoiceId: string, paymentId: string, amount: number) {
        await ensureDefaultAccounts(this.prisma, tenantId);

        const cash = await this.prisma.account.findUnique({
            where: { tenantId_code: { tenantId, code: '1000' } }
        });
        const ar = await this.prisma.account.findUnique({
            where: { tenantId_code: { tenantId, code: '1100' } }
        });

        if (!cash || !ar) throw new BadRequestException('Default accounts missing');

        // Debit Cash, Credit A/R
        return this.prisma.journalEntry.create({
            data: {
                tenantId,
                reference: paymentId,
                memo: `Invoice payment for ${invoiceId}`,
                lines: {
                    create: [
                        { tenantId, accountId: cash.id, debit: amount as any, credit: 0 as any },
                        { tenantId, accountId: ar.id, debit: 0 as any, credit: amount as any }
                    ]
                }
            },
            include: { lines: true }
        });
    }
}