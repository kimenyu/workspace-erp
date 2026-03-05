import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { createRedisConnection } from './redis.connection';
import { GOOGLE_JOBS, JOB_QUEUES, InventoryExportJob, InvoiceSendJob } from './jobs.types';

@Injectable()
export class JobsService {
    private googleQueue: Queue;

    constructor() {
        this.googleQueue = new Queue(JOB_QUEUES.GOOGLE, {
            connection: createRedisConnection()
        });
    }

    enqueueInvoiceSend(data: InvoiceSendJob) {
        return this.googleQueue.add(GOOGLE_JOBS.INVOICE_SEND, data, {
            attempts: 5,
            backoff: { type: 'exponential', delay: 3_000 },
            removeOnComplete: 1000,
            removeOnFail: 2000
        });
    }

    enqueueInventoryExport(data: InventoryExportJob) {
        return this.googleQueue.add(GOOGLE_JOBS.INVENTORY_EXPORT, data, {
            attempts: 5,
            backoff: { type: 'exponential', delay: 3_000 },
            removeOnComplete: 1000,
            removeOnFail: 2000
        });
    }

    async scheduleNightlyInventoryExport(tenantId: string) {
        // Daily at 02:00 (server time). Adjust as you like.
        return this.googleQueue.add(
            'inventory.export.nightly',
            { tenantId },
            {
                repeat: { pattern: '0 2 * * *' }, // cron
                removeOnComplete: 1000,
                removeOnFail: 2000
            }
        );
    }
}