import { Module } from '@nestjs/common';
import { GoogleService } from './google.service';
import { GoogleErpService } from './google-erp.service';
import { GoogleController } from './google.controller';
import { TenancyModule } from '../../tenancy/tenancy.module';
import { JobsModule } from '../../jobs/jobs.module';

@Module({
    imports: [TenancyModule, JobsModule],
    controllers: [GoogleController],
    providers: [GoogleService, GoogleErpService],
    exports: [GoogleErpService],
})
export class GoogleModule {}