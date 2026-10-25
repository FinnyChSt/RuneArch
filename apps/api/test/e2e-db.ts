import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { DEV_USER } from '../src/db/dev-user.js';
import { users } from '../src/db/schema.js';
import { loadEnv, requireEnv } from '../src/env.js';

/*
 * Gives the Playwright end-to-end tests (e2e/) a fresh database: drops and recreates DATABASE_URL's
 * database through ADMIN_DATABASE_URL (the dev database), migrates it and seeds the dev user.
 * Run by Playwright's webServer before it starts the API.
 */

loadEnv();
const target = new URL(requireEnv('DATABASE_URL'));
const name = target.pathname.slice(1);
const admin = postgres(requireEnv('ADMIN_DATABASE_URL'), { max: 1, onnotice: () => {} });
try {
  const quoted = `"${name.replaceAll('"', '""')}"`;
  // WITH (FORCE) closes connections an earlier run left open (PostgreSQL 13+)
  await admin.unsafe(`drop database if exists ${quoted} with (force)`);
  await admin.unsafe(`create database ${quoted}`);
} catch (error) {
  throw new Error('Cannot reach Postgres for the e2e tests (is `docker compose up -d` running?)', { cause: error });
} finally {
  await admin.end();
}

const client = postgres(target.href, { max: 1, onnotice: () => {} });
const db = drizzle(client);
await migrate(db, { migrationsFolder: 'src/db/migrations' });
await db.insert(users).values(DEV_USER);
await client.end();
console.log(`e2e database ${name} ready`);
