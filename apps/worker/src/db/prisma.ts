import { PrismaClient } from '@prisma/client';

let _prisma: PrismaClient;

export function getPrisma(): PrismaClient {
    if (!_prisma) {
        _prisma = new PrismaClient({
            log: ['error'],
        } as any);
    }
    return _prisma;
}

export const prisma = new Proxy({} as PrismaClient, {
    get(_, prop) {
        return getPrisma()[prop as keyof PrismaClient];
    },
});