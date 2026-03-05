import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { TenancyService } from './tenancy.service';

@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private readonly tenancy: TenancyService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const tenantId = this.tenancy.getTenantIdFromHeaders(req.headers);
    req.tenantId = tenantId;
    return true;
  }
}