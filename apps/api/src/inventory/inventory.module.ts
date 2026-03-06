import { Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { FifoService } from './fifo.service';
import { TenancyModule } from '../tenancy/tenancy.module';

@Module({
    imports: [TenancyModule],
    controllers: [InventoryController],
    providers: [InventoryService, FifoService],
    exports: [InventoryService, FifoService],
})
export class InventoryModule {}