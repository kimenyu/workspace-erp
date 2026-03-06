import { Module } from '@nestjs/common';
import { PurchasingController } from './purchasing.controller';
import { PurchasingService } from './purchasing.service';
import { FifoService } from '../inventory/fifo.service';
import { TenancyModule } from '../tenancy/tenancy.module';

@Module({
    imports: [TenancyModule],
    controllers: [PurchasingController],
    providers: [PurchasingService, FifoService],
})
export class PurchasingModule {}