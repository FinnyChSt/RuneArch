import { BadRequestException, Controller, Get, Header, Param, Query, UnprocessableEntityException, UseGuards } from '@nestjs/common';
import { OpenApiExportError, specToYaml, toScopedOpenApi } from '@flowcanvas/shared';
import { CanvasService } from '../canvas/canvas.service.js';
import { exportScope } from '../common/export-scope.js';
import { ProjectAccessGuard } from '../projects/project-access.guard.js';

/**
 * The project's live OpenAPI spec, generated from its canvas (ARCHITECTURE.md §8.6).
 * `?feature=<id>` gives one feature's spec with `x-feature-status` marks (`&only=changes`: only the
 * endpoints it adds, changes or removes); `?unshipped=exclude` leaves out what unshipped features add.
 */
@Controller('projects/:id')
@UseGuards(ProjectAccessGuard)
export class OpenApiExportController {
  constructor(private readonly canvas: CanvasService) {}

  @Get('openapi.json')
  async json(
    @Param('id') id: string,
    @Query('feature') feature?: string,
    @Query('unshipped') unshipped?: string,
    @Query('only') only?: string,
  ) {
    return this.generate(id, feature, unshipped, only);
  }

  @Get('openapi.yaml')
  @Header('Content-Type', 'application/yaml; charset=utf-8')
  async yaml(
    @Param('id') id: string,
    @Query('feature') feature?: string,
    @Query('unshipped') unshipped?: string,
    @Query('only') only?: string,
  ) {
    return specToYaml(await this.generate(id, feature, unshipped, only));
  }

  private async generate(id: string, featureId?: string, unshipped?: string, only?: string) {
    if (only !== undefined && only !== 'changes') throw new BadRequestException(`only must be changes, not ${only}`);
    const { doc } = await this.canvas.load(id);
    const scope = exportScope(doc, featureId, unshipped);
    try {
      return toScopedOpenApi(doc, scope, { onlyChanges: only === 'changes' })!;
    } catch (error) {
      // Saved docs pass CanvasDoc.parse, so this only happens for docs saved under older rules
      if (error instanceof OpenApiExportError) throw new UnprocessableEntityException(error.message);
      throw error;
    }
  }
}
