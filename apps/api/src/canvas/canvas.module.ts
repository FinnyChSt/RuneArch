import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module.js';
import { CanvasController } from './canvas.controller.js';
import { CanvasService } from './canvas.service.js';
import { SnapshotsController } from './snapshots.controller.js';
import { SnapshotsService } from './snapshots.service.js';

@Module({
  imports: [ProjectsModule],
  controllers: [CanvasController, SnapshotsController],
  providers: [CanvasService, SnapshotsService],
  exports: [CanvasService],
})
export class CanvasModule {}
