import type { NestExpressApplication } from '@nestjs/platform-express';
import { HttpExceptionFilter } from './common/http-exception.filter.js';

/** Shared by main.ts and the e2e tests so both run the same pipeline */
export function configureApp(app: NestExpressApplication) {
  app.setGlobalPrefix('api');
  // Canvas docs are saved whole; the default 100 kB JSON limit is too small
  app.useBodyParser('json', { limit: '5mb' });
  app.useGlobalFilters(new HttpExceptionFilter());
  return app;
}
