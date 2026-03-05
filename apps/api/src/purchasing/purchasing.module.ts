import { Module } from '@nestjs/common';
import { PurchasingController } from './purchasing.controller';
import { PurchasingService } from './purchasing.service';
import { FifoService } from '../inventory/fifo.service';

@Module({
    controllers: [PurchasingController],
    providers: [PurchasingService, FifoService]
})
export class PurchasingModule {}