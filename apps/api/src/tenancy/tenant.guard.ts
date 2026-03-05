import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { TenancyService } from './tenancy.service';

@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private readonly tenancy: TenancyService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const tenantId = await this.tenancy.resolveTenantId(req.headers, req.headers.host);
    req.tenantId = tenantId;
    return true;
  }
}