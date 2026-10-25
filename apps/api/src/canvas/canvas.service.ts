import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { CanvasConflict, CanvasResponse, SaveCanvas, SaveCanvasResult } from '@flowcanvas/shared';
import { and, eq, sql } from 'drizzle-orm';
import { DB, type Db } from '../db/db.module.js';
import { canvasDocuments, projects } from '../db/schema.js';

@Injectable()
export class CanvasService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async load(projectId: string): Promise<CanvasResponse> {
    const [row] = await this.db
      .select({ doc: canvasDocuments.doc, version: canvasDocuments.version })
      .from(canvasDocuments)
      .where(eq(canvasDocuments.projectId, projectId));
    if (!row) throw new NotFoundException('Canvas not found');
    return row;
  }

  /**
   * Saves the whole doc if `version` is still current (optimistic locking).
   * `body.doc` has already passed CanvasDoc.parse, including its integrity checks.
   */
  async save(projectId: string, body: SaveCanvas): Promise<SaveCanvasResult> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(canvasDocuments)
        .set({ doc: body.doc, version: sql`${canvasDocuments.version} + 1` })
        .where(and(eq(canvasDocuments.projectId, projectId), eq(canvasDocuments.version, body.version)))
        .returning({ version: canvasDocuments.version });

      if (!row) {
        const [current] = await tx
          .select({ version: canvasDocuments.version })
          .from(canvasDocuments)
          .where(eq(canvasDocuments.projectId, projectId));
        if (!current) throw new NotFoundException('Canvas not found');
        throw new ConflictException({ currentVersion: current.version } satisfies CanvasConflict);
      }

      await tx.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, projectId));
      return row;
    });
  }
}
