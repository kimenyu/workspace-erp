import 'dotenv/config';
import { Worker } from 'bullmq';
import { createRedisConnection } from './redis.connection';
import { GOOGLE_JOBS, JOB_QUEUES } from './jobs.types';

// In this first worker version, we call back into the API via HTTP would be ideal,
// but to keep it copy/paste we process by calling your API endpoints in the next chunk.
// For now, we’ll just log job payloads to prove the worker wiring works.

const connection = createRedisConnection();

async function start() {
    // eslint-disable-next-line no-console
    console.log('Worker starting...');

    const w = new Worker(
        JOB_QUEUES.GOOGLE,
        async (job) => {
            // eslint-disable-next-line no-console
            console.log(`Processing job: ${job.name}`, job.data);

            // NEXT CHUNK: implement real processing by calling the API internal service
            // or reading DB. For now: keep the pipeline wired.
            if (job.name === GOOGLE_JOBS.INVOICE_SEND) {
                // placeholder
                return { ok: true };
            }

            if (job.name === GOOGLE_JOBS.INVENTORY_EXPORT) {
                // placeholder
                return { ok: true };
            }

            return { ok: true };
        },
        { connection }
    );

    w.on('completed', (job) => {
        // eslint-disable-next-line no-console
        console.log(`Completed: ${job.id} ${job.name}`);
    });

    w.on('failed', (job, err) => {
        // eslint-disable-next-line no-console
        console.error(`Failed: ${job?.id} ${job?.name}`, err);
    });
}

start().catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
});