import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { emptyCanvas, type MemberRole, type ProjectMeta } from '@flowcanvas/shared';
import { desc, eq } from 'drizzle-orm';
import { DB, type Db } from '../db/db.module.js';
import { canvasDocuments, projectMembers, projects } from '../db/schema.js';

type ProjectRow = typeof projects.$inferSelect;

const toMeta = (p: ProjectRow, role: MemberRole): ProjectMeta => ({
  id: p.id,
  name: p.name,
  role,
  createdAt: p.createdAt.toISOString(),
  updatedAt: p.updatedAt.toISOString(),
});

@Injectable()
export class ProjectsService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async list(userId: string): Promise<ProjectMeta[]> {
    const rows = await this.db
      .select({ project: projects, role: projectMembers.role })
      .from(projectMembers)
      .innerJoin(projects, eq(projects.id, projectMembers.projectId))
      .where(eq(projectMembers.userId, userId))
      .orderBy(desc(projects.updatedAt));
    return rows.map((r) => toMeta(r.project, r.role));
  }

  /** Creates the project, the owner membership and an empty canvas at version 1 */
  async create(userId: string, name: string): Promise<ProjectMeta> {
    return this.db.transaction(async (tx) => {
      const [project] = await tx.insert(projects).values({ ownerId: userId, name }).returning();
      await tx.insert(projectMembers).values({ projectId: project!.id, userId, role: 'owner' });
      await tx.insert(canvasDocuments).values({ projectId: project!.id, doc: emptyCanvas(), version: 1 });
      return toMeta(project!, 'owner');
    });
  }

  async get(id: string, role: MemberRole): Promise<ProjectMeta> {
    const [project] = await this.db.select().from(projects).where(eq(projects.id, id));
    if (!project) throw new NotFoundException('Project not found');
    return toMeta(project, role);
  }

  async rename(id: string, name: string, role: MemberRole): Promise<ProjectMeta> {
    const [project] = await this.db.update(projects).set({ name }).where(eq(projects.id, id)).returning();
    if (!project) throw new NotFoundException('Project not found');
    return toMeta(project, role);
  }

  async remove(id: string): Promise<void> {
    // Members, canvas and snapshots cascade
    await this.db.delete(projects).where(eq(projects.id, id));
  }
}
