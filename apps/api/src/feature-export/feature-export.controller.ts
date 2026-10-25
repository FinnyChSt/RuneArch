import { BadRequestException, Controller, Get, NotFoundException, Param, Query, Res, UseGuards } from '@nestjs/common';
import { featureExportByFile, SqlDialect } from '@flowcanvas/shared';
import type { Response } from 'express';
import { CanvasService } from '../canvas/canvas.service.js';
import { ProjectAccessGuard } from '../projects/project-access.guard.js';

/**
 * One feature's hand-off: `brief.md`, `brief.json`, `tasks.md`, `migration.up.sql`,
 * `migration.down.sql` (FEATURE_EXPORTS). `?dialect=` picks the SQL dialect (default: the project's).
 */
@Controller('projects/:id/features/:featureId')
@UseGuards(ProjectAccessGuard)
export class FeatureExportController {
  constructor(private readonly canvas: CanvasService) {}

  @Get(':file')
  async export(
    @Param('id') id: string,
    @Param('featureId') featureId: string,
    @Param('file') file: string,
    @Query('dialect') dialectParam: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const format = featureExportByFile(file);
    if (!format) throw new NotFoundException(`Unknown feature export: ${file}`);
    const dialect = SqlDialect.optional().safeParse(dialectParam);
    if (!dialect.success) throw new BadRequestException(`Unknown dialect: ${dialectParam}`);
    const { doc } = await this.canvas.load(id);
    const text = format.render(doc, featureId, { dialect: dialect.data });
    if (text === null) throw new NotFoundException(`Unknown feature: ${featureId}`);
    res.type(`${format.mimeType}; charset=utf-8`);
    return text;
  }
}
