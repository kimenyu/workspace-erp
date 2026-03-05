import { Module } from '@nestjs/common';
import { TenancyService } from './tenancy.service';
import { TenantGuard } from './tenant.guard';

@Module({
  providers: [TenancyService, TenantGuard],
  exports: [TenancyService, TenantGuard]
})
export class TenancyModule {}