import { Module } from '@nestjs/common';
import { CanvasModule } from '../canvas/canvas.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { OpenApiExportController } from './openapi-export.controller.js';

@Module({
  imports: [CanvasModule, ProjectsModule],
  controllers: [OpenApiExportController],
})
export class OpenApiExportModule {}
