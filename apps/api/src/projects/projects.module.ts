import { Module } from '@nestjs/common';
import { ProjectAccessGuard } from './project-access.guard.js';
import { ProjectsController } from './projects.controller.js';
import { ProjectsService } from './projects.service.js';

@Module({
  controllers: [ProjectsController],
  providers: [ProjectsService, ProjectAccessGuard],
  exports: [ProjectAccessGuard],
})
export class ProjectsModule {}
