import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../config/prisma.service';
import { hashPassword, verifyPassword } from '../common/security/password';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { randomUUID } from 'crypto';

@Injectable()
export class AuthService {
    constructor(private readonly prisma: PrismaService, private readonly jwt: JwtService) {}

    private signAccessToken(userId: string, email: string) {
        const expiresIn = process.env.JWT_ACCESS_EXPIRES_IN ?? '15m';
        return this.jwt.sign({ sub: userId, email }, { expiresIn, secret: process.env.JWT_ACCESS_SECRET });
    }

    private signRefreshToken() {
        // refresh token stored in DB, so we can use a strong random token (not JWT)
        return randomUUID() + randomUUID();
    }

    async register(dto: RegisterDto) {
        const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
        if (existing) throw new BadRequestException('Email already in use');

        const tenantExists = await this.prisma.tenant.findUnique({ where: { slug: dto.tenantSlug } });
        if (tenantExists) throw new BadRequestException('Tenant slug already taken');

        const user = await this.prisma.user.create({
            data: {
                email: dto.email,
                fullName: dto.fullName,
                password: await hashPassword(dto.password)
            }
        });

        const tenant = await this.prisma.tenant.create({
            data: { name: dto.tenantName, slug: dto.tenantSlug }
        });

        // Seed default permissions + admin role (idempotent-ish for this tenant)
        // Permission keys (global table) must exist. We'll seed them in RBAC module later too.
        const permKeys = [
            'users.read', 'users.write',
            'inventory.read', 'inventory.write',
            'sales.read', 'sales.write',
            'audit.read'
        ];

        // Ensure permissions exist globally
        for (const key of permKeys) {
            await this.prisma.permission.upsert({
                where: { key },
                update: {},
                create: { key, desc: key }
            });
        }

        const adminRole = await this.prisma.role.create({
            data: {
                tenantId: tenant.id,
                name: 'Admin',
                perms: {
                    create: (await this.prisma.permission.findMany({ where: { key: { in: permKeys } } }))
                        .map((p) => ({ permissionId: p.id }))
                }
            }
        });

        await this.prisma.userTenant.create({
            data: { userId: user.id, tenantId: tenant.id, roleId: adminRole.id }
        });

        const accessToken = this.signAccessToken(user.id, user.email);
        const refreshToken = this.signRefreshToken();

        const refreshExpiresAt = new Date(Date.now() + this.parseDurationToMs(process.env.JWT_REFRESH_EXPIRES_IN ?? '14d'));
        await this.prisma.session.create({
            data: { userId: user.id, refreshToken, expiresAt: refreshExpiresAt }
        });

        return {
            tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
            user: { id: user.id, email: user.email, fullName: user.fullName },
            tokens: { accessToken, refreshToken }
        };
    }

    async login(dto: LoginDto) {
        const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
        if (!user) throw new UnauthorizedException('Invalid credentials');

        const ok = await verifyPassword(dto.password, user.password);
        if (!ok) throw new UnauthorizedException('Invalid credentials');

        const accessToken = this.signAccessToken(user.id, user.email);
        const refreshToken = this.signRefreshToken();

        const refreshExpiresAt = new Date(Date.now() + this.parseDurationToMs(process.env.JWT_REFRESH_EXPIRES_IN ?? '14d'));
        await this.prisma.session.create({
            data: { userId: user.id, refreshToken, expiresAt: refreshExpiresAt }
        });

        return {
            user: { id: user.id, email: user.email, fullName: user.fullName },
            tokens: { accessToken, refreshToken }
        };
    }

    async refresh(refreshToken: string) {
        const session = await this.prisma.session.findUnique({ where: { refreshToken }, include: { user: true } });
        if (!session) throw new ForbiddenException('Invalid refresh token');
        if (session.expiresAt.getTime() < Date.now()) {
            await this.prisma.session.delete({ where: { refreshToken } }).catch(() => undefined);
            throw new ForbiddenException('Refresh token expired');
        }

        const newAccess = this.signAccessToken(session.userId, session.user.email);
        const newRefresh = this.signRefreshToken();

        const refreshExpiresAt = new Date(Date.now() + this.parseDurationToMs(process.env.JWT_REFRESH_EXPIRES_IN ?? '14d'));
        await this.prisma.session.update({
            where: { refreshToken },
            data: { refreshToken: newRefresh, expiresAt: refreshExpiresAt }
        });

        return { tokens: { accessToken: newAccess, refreshToken: newRefresh } };
    }

    async logout(refreshToken: string) {
        await this.prisma.session.delete({ where: { refreshToken } }).catch(() => undefined);
        return { ok: true };
    }

    private parseDurationToMs(v: string): number {
        // supports: 15m, 14d, 12h
        const m = v.trim().match(/^(\d+)([smhd])$/i);
        if (!m) return 14 * 24 * 60 * 60 * 1000;
        const n = Number(m[1]);
        const unit = m[2].toLowerCase();
        const mult = unit === 's' ? 1000 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000;
        return n * mult;
    }
}