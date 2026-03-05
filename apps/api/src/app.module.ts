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
    SalesModule
  ],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor }
  ]
})
export class AppModule {}