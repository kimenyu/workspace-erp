import { PrismaClient } from '@prisma/client';

export async function ensureDefaultAccounts(prisma: PrismaClient, tenantId: string) {
    const defaults = [
        { code: '1000', name: 'Cash', type: 'ASSET' as const },
        { code: '1100', name: 'Accounts Receivable', type: 'ASSET' as const }
    ];

    for (const acc of defaults) {
        await prisma.account.upsert({
            where: { tenantId_code: { tenantId, code: acc.code } },
            update: {},
            create: { tenantId, ...acc }
        });
    }
}