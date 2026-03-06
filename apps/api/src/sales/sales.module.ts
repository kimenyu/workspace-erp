import { Module } from '@nestjs/common';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';
import { JobsModule } from '../jobs/jobs.module';
import { AccountingModule } from '../accounting/accounting.module';
import { InventoryModule } from '../inventory/inventory.module';
import { TenancyModule } from '../tenancy/tenancy.module';

@Module({
    imports: [JobsModule, AccountingModule, InventoryModule, TenancyModule],
    controllers: [SalesController],
    providers: [SalesService],
})
export class SalesModule {}