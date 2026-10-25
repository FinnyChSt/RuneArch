import { Controller, Get, NotFoundException, Param, Res, UseGuards } from '@nestjs/common';
import { screenExportByExtension, wireComponentsOf, wireframeToSvg } from '@flowcanvas/shared';
import type { Response } from 'express';
import { CanvasService } from '../canvas/canvas.service.js';
import { ProjectAccessGuard } from '../projects/project-access.guard.js';

/**
 * The project's screens: a structured description (Markdown or JSON: elements, actions, called
 * endpoints, used models) and each screen's (or component's) wireframe as SVG.
 */
@Controller('projects/:id')
@UseGuards(ProjectAccessGuard)
export class ScreenExportController {
  constructor(private readonly canvas: CanvasService) {}

  @Get('screens.:extension')
  async screens(
    @Param('id') id: string,
    @Param('extension') extension: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const format = screenExportByExtension(extension);
    if (!format) throw new NotFoundException(`Unknown screens format: ${extension}`);
    const { doc } = await this.canvas.load(id);
    res.type(`${format.mimeType}; charset=utf-8`);
    return format.render(doc);
  }

  @Get('screens/:screenId/wireframe.svg')
  async wireframe(
    @Param('id') id: string,
    @Param('screenId') screenId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const { doc } = await this.canvas.load(id);
    const node = doc.nodes.find((n) => n.id === screenId);
    const wireframe = node?.type === 'screen' || node?.type === 'component' ? node.data.wireframe : undefined;
    if (!node || !wireframe) throw new NotFoundException('No wireframe for this screen');
    res.type('image/svg+xml; charset=utf-8');
    return wireframeToSvg(wireframe, { title: node.label || undefined, components: wireComponentsOf(doc) });
  }
}
