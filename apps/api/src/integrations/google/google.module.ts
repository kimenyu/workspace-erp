import { Module } from '@nestjs/common';
import { GoogleService } from './google.service';
import { GoogleErpService } from './google-erp.service';
import { GoogleController } from './google.controller';

@Module({
    controllers: [GoogleController],
    providers: [GoogleService, GoogleErpService],
    exports: [GoogleErpService]
})
export class GoogleModule {}