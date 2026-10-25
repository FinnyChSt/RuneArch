import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { DB } from '../db/db.module.js';
import { HealthController } from './health.controller.js';

const setup = async (execute: () => Promise<unknown>) => {
  const moduleRef = await Test.createTestingModule({
    controllers: [HealthController],
    providers: [{ provide: DB, useValue: { execute } }],
  }).compile();
  return moduleRef.get(HealthController);
};

describe('HealthController', () => {
  it('reports the database as up and the shared schema version', async () => {
    const controller = await setup(async () => []);
    await expect(controller.check()).resolves.toEqual({ status: 'ok', db: 'up', schemaVersion: 1 });
  });

  it('reports the database as down when the query fails', async () => {
    const controller = await setup(async () => {
      throw new Error('connection refused');
    });
    await expect(controller.check()).resolves.toMatchObject({ db: 'down' });
  });
});
