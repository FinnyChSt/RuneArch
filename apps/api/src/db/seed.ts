import { loadEnv, requireEnv } from '../env.js';
import { createDb } from './client.js';
import { DEV_USER } from './dev-user.js';
import { users } from './schema.js';

loadEnv();
const db = createDb(requireEnv('DATABASE_URL'));

const [user] = await db
  .insert(users)
  .values(DEV_USER)
  .onConflictDoUpdate({ target: users.email, set: { name: DEV_USER.name } })
  .returning();

console.log(`Seeded dev user ${user?.email} (${user?.id})`);
await db.$client.end();
