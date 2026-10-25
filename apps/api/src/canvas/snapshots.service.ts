import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { beforeRestoreLabel, CanvasDoc, type CanvasResponse, type SnapshotDetail, type SnapshotMeta } from '@flowcanvas/shared';
import { and, desc, eq, sql } from 'drizzle-orm';
import { DB, type Db } from '../db/db.module.js';
import { canvasDocuments, canvasSnapshots, projects, users } from '../db/schema.js';

/** Newest first; older ones stay stored but aren't listed */
const LIST_LIMIT = 200;

const meta = {
  id: canvasSnapshots.id,
  label: canvasSnapshots.label,
  createdAt: canvasSnapshots.createdAt,
  createdBy: users.name,
};

const toMeta = (row: { id: string; label: string | null; createdAt: Date; createdBy: string | null }): SnapshotMeta => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
});

/**
 * Named checkpoints of a project's canvas (ARCHITECTURE.md §8.8). A checkpoint copies the saved
 * doc; restoring first checkpoints the current doc, so nothing is ever lost.
 */
@Injectable()
export class SnapshotsService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async list(projectId: string): Promise<SnapshotMeta[]> {
    const rows = await this.db
      .select(meta)
      .from(canvasSnapshots)
      .leftJoin(users, eq(users.id, canvasSnapshots.createdBy))
      .where(eq(canvasSnapshots.projectId, projectId))
      .orderBy(desc(canvasSnapshots.createdAt), desc(canvasSnapshots.id))
      .limit(LIST_LIMIT);
    return rows.map(toMeta);
  }

  async create(projectId: string, userId: string, label: string | undefined): Promise<SnapshotMeta> {
    return this.db.transaction(async (tx) => {
      const [current] = await tx.select({ doc: canvasDocuments.doc }).from(canvasDocuments).where(eq(canvasDocuments.projectId, projectId));
      if (!current) throw new NotFoundException('Canvas not found');
      const [row] = await tx
        .insert(canvasSnapshots)
        .values({ projectId, doc: current.doc, label: label || null, createdBy: userId })
        .returning({ id: canvasSnapshots.id });
      return this.meta(tx, projectId, row!.id);
    });
  }

  async get(projectId: string, snapshotId: string): Promise<SnapshotDetail> {
    const [row] = await this.db
      .select({ ...meta, doc: canvasSnapshots.doc })
      .from(canvasSnapshots)
      .leftJoin(users, eq(users.id, canvasSnapshots.createdBy))
      .where(and(eq(canvasSnapshots.projectId, projectId), eq(canvasSnapshots.id, snapshotId)));
    if (!row) throw new NotFoundException('Snapshot not found');
    return { ...toMeta(row), doc: CanvasDoc.parse(row.doc) };
  }

  /** Checkpoints the current doc, then makes the snapshot's doc current (a new version) */
  async restore(projectId: string, snapshotId: string, userId: string): Promise<CanvasResponse> {
    return this.db.transaction(async (tx) => {
      const [snapshot] = await tx
        .select({ doc: canvasSnapshots.doc, label: canvasSnapshots.label })
        .from(canvasSnapshots)
        .where(and(eq(canvasSnapshots.projectId, projectId), eq(canvasSnapshots.id, snapshotId)));
      if (!snapshot) throw new NotFoundException('Snapshot not found');
      // Lock the canvas row so a concurrent save can't slip between the checkpoint and the restore
      const [current] = await tx
        .select({ doc: canvasDocuments.doc })
        .from(canvasDocuments)
        .where(eq(canvasDocuments.projectId, projectId))
        .for('update');
      if (!current) throw new NotFoundException('Canvas not found');

      await tx.insert(canvasSnapshots).values({ projectId, doc: current.doc, label: beforeRestoreLabel(snapshot.label), createdBy: userId });
      // Stored docs were valid when saved; parsing again applies today's defaults (and future migrations)
      const doc = CanvasDoc.parse(snapshot.doc);
      const [row] = await tx
        .update(canvasDocuments)
        .set({ doc, version: sql`${canvasDocuments.version} + 1` })
        .where(eq(canvasDocuments.projectId, projectId))
        .returning({ version: canvasDocuments.version });
      await tx.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, projectId));
      return { doc, version: row!.version };
    });
  }

  async remove(projectId: string, snapshotId: string): Promise<void> {
    const deleted = await this.db
      .delete(canvasSnapshots)
      .where(and(eq(canvasSnapshots.projectId, projectId), eq(canvasSnapshots.id, snapshotId)))
      .returning({ id: canvasSnapshots.id });
    if (deleted.length === 0) throw new NotFoundException('Snapshot not found');
  }

  private async meta(db: Pick<Db, 'select'>, projectId: string, id: string): Promise<SnapshotMeta> {
    const [row] = await db
      .select(meta)
      .from(canvasSnapshots)
      .leftJoin(users, eq(users.id, canvasSnapshots.createdBy))
      .where(and(eq(canvasSnapshots.projectId, projectId), eq(canvasSnapshots.id, id)));
    return toMeta(row!);
  }
}
