import { Module } from '@nestjs/common';
import { CanvasModule } from '../canvas/canvas.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { ScreenExportController } from './screen-export.controller.js';

@Module({
  imports: [CanvasModule, ProjectsModule],
  controllers: [ScreenExportController],
})
export class ScreenExportModule {}
