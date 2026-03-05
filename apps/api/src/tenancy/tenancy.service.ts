import { BadRequestException, Injectable } from '@nestjs/common';

@Injectable()
export class TenancyService {
  getTenantIdFromHeaders(headers: Record<string, any>): string {
    const tenantId = headers['x-tenant-id'] || headers['X-Tenant-Id'];
    if (!tenantId || typeof tenantId !== 'string') {
      throw new BadRequestException('Missing X-Tenant-Id header');
    }
    return tenantId;
  }
}