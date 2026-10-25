import { BadRequestException, Controller, Get, NotFoundException, Param, Query, Res, UseGuards } from '@nestjs/common';
import { featureAnnotations, schemaExportByExtension, SqlDialect } from '@flowcanvas/shared';
import type { Response } from 'express';
import { CanvasService } from '../canvas/canvas.service.js';
import { scopedDoc } from '../common/export-scope.js';
import { ProjectAccessGuard } from '../projects/project-access.guard.js';

/**
 * The project's live database schema (DBML, Mermaid, SQL), generated from its canvas tables.
 * `?dialect=mysql|mariadb|postgresql|sqlite` picks the SQL dialect (default: the project's).
 * `?feature=<id>` exports one feature's tables marked by role; `?unshipped=exclude` leaves out what
 * unshipped features add.
 */
@Controller('projects/:id')
@UseGuards(ProjectAccessGuard)
export class SchemaExportController {
  constructor(private readonly canvas: CanvasService) {}

  @Get('schema.:extension')
  async schema(
    @Param('id') id: string,
    @Param('extension') extension: string,
    @Query('dialect') dialectParam: string | undefined,
    @Query('feature') featureId: string | undefined,
    @Query('unshipped') unshipped: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const format = schemaExportByExtension(extension);
    if (!format) throw new NotFoundException(`Unknown schema format: ${extension}`);
    const dialect = SqlDialect.optional().safeParse(dialectParam);
    if (!dialect.success) throw new BadRequestException(`Unknown dialect: ${dialectParam}`);
    const { doc } = await this.canvas.load(id);
    const scoped = scopedDoc(doc, featureId, unshipped);
    const feature = featureId ? (featureAnnotations(doc, featureId) ?? undefined) : undefined;
    res.type(`${format.mimeType}; charset=utf-8`);
    return format.render(scoped.doc, { dialect: dialect.data, feature });
  }
}
