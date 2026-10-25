import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { DevAuthGuard } from './auth.js';

@Module({
  // useExisting lets tests swap the guard with overrideProvider(DevAuthGuard)
  providers: [DevAuthGuard, { provide: APP_GUARD, useExisting: DevAuthGuard }],
})
export class AuthModule {}
