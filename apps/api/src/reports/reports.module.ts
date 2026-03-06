import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { TenancyModule } from '../tenancy/tenancy.module';

@Module({
    imports: [TenancyModule],
    controllers: [ReportsController],
    providers: [ReportsService],
})
export class ReportsModule {}