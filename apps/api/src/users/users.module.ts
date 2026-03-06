import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { TenancyModule } from '../tenancy/tenancy.module';

@Module({
    imports: [TenancyModule],
    controllers: [UsersController],
})
export class UsersModule {}