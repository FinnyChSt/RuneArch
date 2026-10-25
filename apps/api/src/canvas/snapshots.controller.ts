import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { CreateSnapshot } from '@flowcanvas/shared';
import { type AuthUser, CurrentUser } from '../auth/auth.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ProjectAccessGuard, RequireRole } from '../projects/project-access.guard.js';
import { SnapshotsService } from './snapshots.service.js';

@Controller('projects/:id/snapshots')
@UseGuards(ProjectAccessGuard)
export class SnapshotsController {
  constructor(private readonly snapshots: SnapshotsService) {}

  /** Newest first, without docs */
  @Get()
  list(@Param('id') id: string) {
    return this.snapshots.list(id);
  }

  /** Checkpoints the saved canvas */
  @Post()
  @RequireRole('editor')
  create(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(CreateSnapshot)) body: CreateSnapshot) {
    return this.snapshots.create(id, user.id, body.label);
  }

  @Get(':sid')
  get(@Param('id') id: string, @Param('sid', ParseUUIDPipe) sid: string) {
    return this.snapshots.get(id, sid);
  }

  /** Checkpoints the current canvas, then restores this one: `{ doc, version }` */
  @Post(':sid/restore')
  @HttpCode(200)
  @RequireRole('editor')
  restore(@Param('id') id: string, @Param('sid', ParseUUIDPipe) sid: string, @CurrentUser() user: AuthUser) {
    return this.snapshots.restore(id, sid, user.id);
  }

  @Delete(':sid')
  @HttpCode(204)
  @RequireRole('editor')
  async remove(@Param('id') id: string, @Param('sid', ParseUUIDPipe) sid: string) {
    await this.snapshots.remove(id, sid);
  }
}
