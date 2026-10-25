import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { MemberRole } from '@flowcanvas/shared';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthedRequest } from '../auth/auth.js';
import { DB, type Db } from '../db/db.module.js';
import { projectMembers } from '../db/schema.js';

const REQUIRED_ROLE = 'requiredRole';
const RANK: Record<MemberRole, number> = { viewer: 0, editor: 1, owner: 2 };
const ProjectId = z.uuid();

/** Minimum role for a route guarded by ProjectAccessGuard (default: viewer) */
export const RequireRole = (role: MemberRole) => SetMetadata(REQUIRED_ROLE, role);

export type ProjectRequest = AuthedRequest & { projectRole: MemberRole };

/**
 * Checks that the current user is a member of project `:id` with at least the required role.
 * Non-members and malformed ids get 404 so project ids can't be probed.
 */
@Injectable()
export class ProjectAccessGuard implements CanActivate {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<ProjectRequest>();
    const required =
      this.reflector.getAllAndOverride<MemberRole>(REQUIRED_ROLE, [ctx.getHandler(), ctx.getClass()]) ?? 'viewer';

    const projectId = req.params.id;
    if (!ProjectId.safeParse(projectId).success) throw new NotFoundException('Project not found');

    const [member] = await this.db
      .select({ role: projectMembers.role })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId as string), eq(projectMembers.userId, req.user.id)));
    if (!member) throw new NotFoundException('Project not found');
    if (RANK[member.role] < RANK[required]) throw new ForbiddenException(`Requires ${required} role`);

    req.projectRole = member.role;
    return true;
  }
}

/** The current user's role in the project, resolved by ProjectAccessGuard */
export const ProjectRole = createParamDecorator(
  (_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<ProjectRequest>().projectRole,
);
