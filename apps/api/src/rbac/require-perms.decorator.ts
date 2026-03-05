import { SetMetadata } from '@nestjs/common';

export const REQUIRE_PERMS_KEY = 'require_perms';
export const RequirePerms = (...perms: string[]) => SetMetadata(REQUIRE_PERMS_KEY, perms);