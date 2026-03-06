import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

let _prisma: PrismaClient;

function getPrisma(): PrismaClient {
    if (!_prisma) {
        const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
        _prisma = new PrismaClient({ adapter });
    }
    return _prisma;
}

export const prisma = new Proxy({} as PrismaClient, {
    get(_, prop) {
        return getPrisma()[prop as keyof PrismaClient];
    },
});