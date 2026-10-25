import { Module } from '@nestjs/common';
import { CanvasModule } from '../canvas/canvas.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { FeatureExportController } from './feature-export.controller.js';

@Module({
  imports: [CanvasModule, ProjectsModule],
  controllers: [FeatureExportController],
})
export class FeatureExportModule {}
