import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { CreateProject, UpdateProject, type MemberRole } from '@flowcanvas/shared';
import { type AuthUser, CurrentUser } from '../auth/auth.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ProjectAccessGuard, ProjectRole, RequireRole } from './project-access.guard.js';
import { ProjectsService } from './projects.service.js';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.projects.list(user.id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(CreateProject)) body: CreateProject) {
    return this.projects.create(user.id, body.name);
  }

  @Get(':id')
  @UseGuards(ProjectAccessGuard)
  get(@Param('id') id: string, @ProjectRole() role: MemberRole) {
    return this.projects.get(id, role);
  }

  @Patch(':id')
  @UseGuards(ProjectAccessGuard)
  @RequireRole('editor')
  rename(
    @Param('id') id: string,
    @ProjectRole() role: MemberRole,
    @Body(new ZodValidationPipe(UpdateProject)) body: UpdateProject,
  ) {
    return this.projects.rename(id, body.name, role);
  }

  @Delete(':id')
  @UseGuards(ProjectAccessGuard)
  @RequireRole('owner')
  @HttpCode(204)
  remove(@Param('id') id: string) {
    return this.projects.remove(id);
  }
}
