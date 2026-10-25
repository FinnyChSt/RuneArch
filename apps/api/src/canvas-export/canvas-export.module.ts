import { Module } from '@nestjs/common';
import { CanvasModule } from '../canvas/canvas.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { CanvasExportController } from './canvas-export.controller.js';

@Module({
  imports: [CanvasModule, ProjectsModule],
  controllers: [CanvasExportController],
})
export class CanvasExportModule {}
