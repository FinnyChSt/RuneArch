import { z } from 'zod';
import { CanvasDoc } from './canvas';

/* ============================================================
 * REST contract between web and api (ARCHITECTURE.md §6)
 * ============================================================ */

export const MEMBER_ROLES = ['owner', 'editor', 'viewer'] as const;
export const MemberRole = z.enum(MEMBER_ROLES);

export const ProjectName = z.string().trim().min(1, 'Name is required').max(120);

export const CreateProject = z.object({ name: ProjectName });
export const UpdateProject = z.object({ name: ProjectName });

export const ProjectMeta = z.object({
  id: z.uuid(),
  name: z.string(),
  /** The current user's role in this project */
  role: MemberRole,
  createdAt: z.string(),
  updatedAt: z.string(),
});

/** Canvas versions start at 1 and increase by one per successful save */
export const CanvasVersion = z.number().int().positive();

export const CanvasResponse = z.object({ doc: CanvasDoc, version: CanvasVersion });

/** PUT /projects/:id/canvas — `version` is the version the doc was based on */
export const SaveCanvas = z.object({ doc: CanvasDoc, version: CanvasVersion });
export const SaveCanvasResult = z.object({ version: CanvasVersion });

/** 409 body when `version` is stale */
export const CanvasConflict = z.object({ currentVersion: CanvasVersion });

/* ---------- Snapshots: named checkpoints of the canvas ---------- */

export const SnapshotLabel = z.string().trim().max(120, 'Keep it under 120 characters');

/** POST /projects/:id/snapshots — the label is optional */
export const CreateSnapshot = z.object({ label: SnapshotLabel.optional() });

export const SnapshotMeta = z.object({
  id: z.uuid(),
  label: z.string().nullable(),
  createdAt: z.string(),
  /** Name of the user who saved it; null if the account is gone */
  createdBy: z.string().nullable(),
});

/** GET /projects/:id/snapshots/:sid — the checkpoint with its document */
export const SnapshotDetail = SnapshotMeta.extend({ doc: CanvasDoc });

/** Label of the checkpoint a restore saves first, so the restore can be undone */
export const beforeRestoreLabel = (label: string | null) => `Before restoring ${label ? `“${label}”` : 'a checkpoint'}`;

export const ValidationIssue = z.object({
  path: z.array(z.union([z.string(), z.number()])),
  message: z.string(),
});

/** 400 body for any schema violation */
export const ValidationErrorBody = z.object({ issues: z.array(ValidationIssue) });

export type MemberRole = z.infer<typeof MemberRole>;
export type CreateProject = z.infer<typeof CreateProject>;
export type UpdateProject = z.infer<typeof UpdateProject>;
export type ProjectMeta = z.infer<typeof ProjectMeta>;
export type CanvasResponse = z.infer<typeof CanvasResponse>;
export type SaveCanvas = z.infer<typeof SaveCanvas>;
export type SaveCanvasResult = z.infer<typeof SaveCanvasResult>;
export type CanvasConflict = z.infer<typeof CanvasConflict>;
export type CreateSnapshot = z.infer<typeof CreateSnapshot>;
export type SnapshotMeta = z.infer<typeof SnapshotMeta>;
export type SnapshotDetail = z.infer<typeof SnapshotDetail>;
export type ValidationIssue = z.infer<typeof ValidationIssue>;
export type ValidationErrorBody = z.infer<typeof ValidationErrorBody>;

/** Converts Zod issues to the wire format (paths without symbols) */
export const toValidationIssues = (issues: readonly z.core.$ZodIssue[]): ValidationIssue[] =>
  issues.map((i) => ({
    path: i.path.filter((p): p is string | number => typeof p !== 'symbol'),
    message: i.message,
  }));
