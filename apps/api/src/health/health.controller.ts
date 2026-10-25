import { Controller, Get, Inject } from '@nestjs/common';
import { emptyCanvas } from '@flowcanvas/shared';
import { sql } from 'drizzle-orm';
import { Public } from '../auth/auth.js';
import { DB, type Db } from '../db/db.module.js';

@Public()
@Controller('health')
export class HealthController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get()
  async check() {
    const db = await this.db
      .execute(sql`select 1`)
      .then(() => 'up' as const)
      .catch(() => 'down' as const);
    return { status: 'ok', db, schemaVersion: emptyCanvas().schemaVersion };
  }
}
