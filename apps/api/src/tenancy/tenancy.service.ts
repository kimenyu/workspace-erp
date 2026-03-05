import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../config/prisma.service';

@Injectable()
export class TenancyService {
  constructor(private readonly prisma: PrismaService) {}

  // Prefer header for local/dev/testing; fallback to subdomain for production.
  async resolveTenantId(headers: Record<string, any>, host?: string): Promise<string> {
    const headerTenantId = headers['x-tenant-id'] || headers['X-Tenant-Id'];
    if (headerTenantId && typeof headerTenantId === 'string') return headerTenantId;

    const slug = this.getTenantSlugFromHost(host);
    if (!slug) {
      throw new BadRequestException('Missing X-Tenant-Id header and no tenant subdomain found');
    }

    const tenant = await this.prisma.tenant.findUnique({ where: { slug } });
    if (!tenant) throw new BadRequestException(`Unknown tenant slug: ${slug}`);

    return tenant.id;
  }

  private getTenantSlugFromHost(host?: string): string | null {
    if (!host) return null;

    // host could be "acme.yourapp.com:4000"
    const clean = host.split(':')[0].toLowerCase();

    // For localhost dev like "acme.localhost"
    const parts = clean.split('.');
    if (parts.length < 2) return null;

    const subdomain = parts[0];
    // avoid "www"
    if (!subdomain || subdomain === 'www') return null;

    return subdomain;
  }
}