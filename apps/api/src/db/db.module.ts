import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { requireEnv } from '../env.js';
import { createDb, type Db } from './client.js';

export const DB = Symbol('DB');
export type { Db };

@Global()
@Module({
  providers: [{ provide: DB, useFactory: () => createDb(requireEnv('DATABASE_URL')) }],
  exports: [DB],
})
export class DbModule implements OnApplicationShutdown {
  constructor(@Inject(DB) private readonly db: Db) {}

  async onApplicationShutdown() {
    await this.db.$client.end();
  }
}
