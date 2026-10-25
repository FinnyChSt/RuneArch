import { BadRequestException, Controller, Get, NotFoundException, Param, Query, Res, UseGuards } from '@nestjs/common';
import { canvasExportByExtension, featureById, type CanvasSvgTheme } from '@flowcanvas/shared';
import type { Response } from 'express';
import { CanvasService } from '../canvas/canvas.service.js';
import { scopedDoc } from '../common/export-scope.js';
import { ProjectAccessGuard } from '../projects/project-access.guard.js';

const THEMES: readonly CanvasSvgTheme[] = ['light', 'dark'];

/**
 * The whole canvas as an SVG image, a Mermaid flowchart or a RuneArch JSON file.
 * `?theme=light|dark` picks the image colors, `?flow=<flowId>` highlights one flow (SVG, Mermaid).
 * `?feature=<id>` exports one feature's part, marked by role; `?unshipped=exclude` leaves out what
 * unshipped features add.
 */
@Controller('projects/:id')
@UseGuards(ProjectAccessGuard)
export class CanvasExportController {
  constructor(private readonly canvas: CanvasService) {}

  @Get('canvas.:extension')
  async export(
    @Param('id') id: string,
    @Param('extension') extension: string,
    @Query('theme') theme: string | undefined,
    @Query('flow') flowId: string | undefined,
    @Query('feature') featureId: string | undefined,
    @Query('unshipped') unshipped: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const format = canvasExportByExtension(extension);
    if (!format) throw new NotFoundException(`Unknown canvas format: ${extension}`);
    if (theme !== undefined && !THEMES.includes(theme as CanvasSvgTheme)) throw new BadRequestException(`Unknown theme: ${theme}`);
    const { doc } = await this.canvas.load(id);
    if (flowId !== undefined && !doc.flows.some((f) => f.id === flowId)) throw new NotFoundException(`Unknown flow: ${flowId}`);
    const scoped = scopedDoc(doc, featureId, unshipped);
    const f = featureId ? featureById(doc, featureId) : undefined;
    const feature = f && scoped.roles ? { name: f.name, color: f.color, roles: scoped.roles } : undefined;
    res.type(`${format.mimeType}; charset=utf-8`);
    return format.render(scoped.doc, { theme: theme as CanvasSvgTheme | undefined, flowId, feature });
  }
}
