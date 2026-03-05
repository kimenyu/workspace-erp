import 'dotenv/config';
import { Worker } from 'bullmq';
import { createRedisConnection } from './redis.connection';
import { GOOGLE_JOBS, JOB_QUEUES } from './jobs.types';
import { prisma } from './db/prisma';
import { GoogleErpWorker } from './google.erp.worker';

const connection = createRedisConnection();

async function start() {
    // eslint-disable-next-line no-console
    console.log('Worker starting (DB + Google enabled)...');

    const googleErp = new GoogleErpWorker();

    const w = new Worker(
        JOB_QUEUES.GOOGLE,
        async (job) => {
            if (job.name === GOOGLE_JOBS.INVOICE_SEND) {
                const { tenantId, invoiceId } = job.data as { tenantId: string; invoiceId: string };
                return googleErp.sendInvoiceEmail(tenantId, invoiceId);
            }

            if (job.name === GOOGLE_JOBS.INVENTORY_EXPORT) {
                const { tenantId } = job.data as { tenantId: string };
                return googleErp.exportInventoryToSheet(tenantId);
            }

            return { ok: true };
        },
        { connection }
    );

    w.on('completed', (job, res) => {
        // eslint-disable-next-line no-console
        console.log(`Completed: ${job.id} ${job.name}`, res);
    });

    w.on('failed', (job, err) => {
        // eslint-disable-next-line no-console
        console.error(`Failed: ${job?.id} ${job?.name}`, err);
    });

    // Graceful shutdown
    process.on('SIGINT', async () => {
        // eslint-disable-next-line no-console
        console.log('Shutting down...');
        await w.close();
        await prisma.$disconnect();
        process.exit(0);
    });
}

start().catch(async (e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    await prisma.$disconnect().catch(() => undefined);
    process.exit(1);
});