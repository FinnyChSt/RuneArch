import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Inject,
  Injectable,
  SetMetadata,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { eq } from 'drizzle-orm';
import type { Request } from 'express';
import { DB, type Db } from '../db/db.module.js';
import { DEV_USER } from '../db/dev-user.js';
import { users } from '../db/schema.js';

export type AuthUser = typeof users.$inferSelect;
export type AuthedRequest = Request & { user: AuthUser };

const IS_PUBLIC = 'isPublic';

/** Skips authentication, e.g. for the health check */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<AuthedRequest>().user,
);

/**
 * Phase 1–2 auth stub: every request acts as the seeded dev user.
 * Registered as the global guard; replaced by real (JWT) auth later.
 */
@Injectable()
export class DevAuthGuard implements CanActivate {
  private user?: Promise<AuthUser>;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext) {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()])) return true;
    ctx.switchToHttp().getRequest<AuthedRequest>().user = await (this.user ??= this.loadDevUser());
    return true;
  }

  private async loadDevUser(): Promise<AuthUser> {
    const [user] = await this.db.select().from(users).where(eq(users.email, DEV_USER.email));
    if (!user) {
      this.user = undefined; // retry once the seed has run
      throw new ServiceUnavailableException('Dev user missing; run `pnpm --filter api db:seed`');
    }
    return user;
  }
}
