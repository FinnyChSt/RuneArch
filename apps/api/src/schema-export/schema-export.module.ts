import { Module } from '@nestjs/common';
import { CanvasModule } from '../canvas/canvas.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { SchemaExportController } from './schema-export.controller.js';

@Module({
  imports: [CanvasModule, ProjectsModule],
  controllers: [SchemaExportController],
})
export class SchemaExportModule {}
