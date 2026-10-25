import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import type { TestProject } from 'vitest/node';
import { loadEnv, requireEnv } from '../src/env.js';

/** Creates the test database (if missing) next to the dev one and migrates it */
export default async function setup(project: TestProject) {
  loadEnv();
  const devUrl = new URL(requireEnv('DATABASE_URL'));
  const testUrl = new URL(process.env.TEST_DATABASE_URL ?? devUrl);
  if (!process.env.TEST_DATABASE_URL) testUrl.pathname = `${devUrl.pathname}_test`;
  const name = testUrl.pathname.slice(1);

  const admin = postgres(devUrl.href, { max: 1, onnotice: () => {} });
  try {
    const [exists] = await admin`select 1 from pg_database where datname = ${name}`;
    if (!exists) await admin.unsafe(`create database "${name.replaceAll('"', '""')}"`);
  } catch (error) {
    throw new Error('Cannot reach Postgres for e2e tests (is `docker compose up -d` running?)', { cause: error });
  } finally {
    await admin.end();
  }

  const client = postgres(testUrl.href, { max: 1, onnotice: () => {} });
  await migrate(drizzle(client), { migrationsFolder: 'src/db/migrations' });
  await client.end();

  project.provide('testDatabaseUrl', testUrl.href);
}

declare module 'vitest' {
  export interface ProvidedContext {
    testDatabaseUrl: string;
  }
}
