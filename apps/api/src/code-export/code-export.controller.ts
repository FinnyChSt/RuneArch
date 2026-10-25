import { Controller, Get, NotFoundException, Param, Query, Res, UseGuards } from '@nestjs/common';
import { codeExportByTarget } from '@flowcanvas/shared';
import type { Response } from 'express';
import { CanvasService } from '../canvas/canvas.service.js';
import { scopedDoc } from '../common/export-scope.js';
import { ProjectAccessGuard } from '../projects/project-access.guard.js';

/**
 * Code generated from the project's canvas: `pydantic` (API models), `sqlalchemy`, `sqlmodel`, `drizzle`, `prisma` (tables),
 * `fastapi` (endpoints) or `zod` (API models).
 * `?feature=<id>` exports one feature's part with each class marked by its role; `?unshipped=exclude`
 * leaves out what unshipped features add.
 */
@Controller('projects/:id')
@UseGuards(ProjectAccessGuard)
export class CodeExportController {
  constructor(private readonly canvas: CanvasService) {}

  @Get('code/:target')
  async code(
    @Param('id') id: string,
    @Param('target') target: string,
    @Query('feature') featureId: string | undefined,
    @Query('unshipped') unshipped: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const generator = codeExportByTarget(target);
    if (!generator) throw new NotFoundException(`Unknown code target: ${target}`);
    const { doc } = await this.canvas.load(id);
    const scoped = scopedDoc(doc, featureId, unshipped);
    res.type(`${generator.mimeType}; charset=utf-8`);
    return generator.render(scoped.doc, scoped);
  }
}
