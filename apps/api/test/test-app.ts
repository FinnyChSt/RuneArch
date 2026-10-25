import { type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { inject } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { type AuthUser, type AuthedRequest, DevAuthGuard } from '../src/auth/auth.js';
import { createDb } from '../src/db/client.js';
import { DB } from '../src/db/db.module.js';
import { projectMembers, users } from '../src/db/schema.js';
import type { MemberRole } from '@flowcanvas/shared';

/** Stands in for the dev auth stub so tests can switch users */
class TestAuthGuard implements CanActivate {
  current: AuthUser | null = null;
  canActivate(ctx: ExecutionContext) {
    if (this.current) ctx.switchToHttp().getRequest<AuthedRequest>().user = this.current;
    return true;
  }
}

/** Full app (same pipeline as main.ts) against the test database */
export async function createTestApp() {
  const db = createDb(inject('testDatabaseUrl'));
  const auth = new TestAuthGuard();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DB)
    .useValue(db)
    .overrideProvider(DevAuthGuard)
    .useValue(auth)
    .compile();
  const app = configureApp(moduleRef.createNestApplication<NestExpressApplication>({ logger: false }));
  await app.init();

  return {
    app,
    http: () => request(app.getHttpServer()),
    /** Empties all tables and creates fresh users; the first one is signed in */
    async reset(...emails: string[]) {
      await db.execute(sql`truncate table users, projects restart identity cascade`);
      const created = await db
        .insert(users)
        .values(emails.map((email) => ({ email, name: email.split('@')[0]! })))
        .returning();
      auth.current = created[0] ?? null;
      return created;
    },
    signInAs(user: AuthUser) {
      auth.current = user;
    },
    async addMember(projectId: string, user: AuthUser, role: MemberRole) {
      await db.insert(projectMembers).values({ projectId, userId: user.id, role });
    },
  };
}
