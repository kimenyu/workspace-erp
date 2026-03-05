import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './config/prisma.module';
import { AuthModule } from './auth/auth.module';
import { TenancyModule } from './tenancy/tenancy.module';
import { UsersModule } from './users/users.module';
import { RbacModule } from './rbac/rbac.module';
import { AuditModule } from './audit/audit.module';
import { AuditInterceptor } from './audit/audit.interceptor';
import { InventoryModule } from './inventory/inventory.module';
import { SalesModule } from './sales/sales.module';
import { JobsModule } from './jobs/jobs.module';
import { GoogleModule } from './integrations/google/google.module';
import { AccountingModule } from './accounting/accounting.module';
import { PurchasingModule } from './purchasing/purchasing.module';
import { ReportsModule } from './reports/reports.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    TenancyModule,
    AuthModule,
    UsersModule,
    RbacModule,
    InventoryModule,
    AuditModule,
    JobsModule,
    SalesModule,
    GoogleModule,
    AccountingModule,
    PurchasingModule,
    ReportsModule
  ],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor }
  ]
})
export class AppModule {}