import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { SaveCanvas } from '@flowcanvas/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ProjectAccessGuard, RequireRole } from '../projects/project-access.guard.js';
import { CanvasService } from './canvas.service.js';

@Controller('projects/:id/canvas')
@UseGuards(ProjectAccessGuard)
export class CanvasController {
  constructor(private readonly canvas: CanvasService) {}

  @Get()
  load(@Param('id') id: string) {
    return this.canvas.load(id);
  }

  /** 200 { version } or 409 { currentVersion } */
  @Put()
  @RequireRole('editor')
  save(@Param('id') id: string, @Body(new ZodValidationPipe(SaveCanvas)) body: SaveCanvas) {
    return this.canvas.save(id, body);
  }
}
