import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module.js';
import { CanvasExportModule } from './canvas-export/canvas-export.module.js';
import { CanvasModule } from './canvas/canvas.module.js';
import { CodeExportModule } from './code-export/code-export.module.js';
import { DbModule } from './db/db.module.js';
import { FeatureExportModule } from './feature-export/feature-export.module.js';
import { HealthController } from './health/health.controller.js';
import { OpenApiExportModule } from './openapi-export/openapi-export.module.js';
import { ProjectsModule } from './projects/projects.module.js';
import { SchemaExportModule } from './schema-export/schema-export.module.js';
import { ScreenExportModule } from './screen-export/screen-export.module.js';

@Module({
  imports: [DbModule, AuthModule, ProjectsModule, CanvasModule, OpenApiExportModule, SchemaExportModule, CodeExportModule, ScreenExportModule, CanvasExportModule, FeatureExportModule],
  controllers: [HealthController],
})
export class AppModule {}
