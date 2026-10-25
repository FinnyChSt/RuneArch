import {
  CanvasConflict,
  CanvasResponse,
  ProjectMeta,
  SaveCanvasResult,
  SnapshotDetail,
  SnapshotMeta,
  ValidationErrorBody,
  type SaveCanvas,
  type ValidationIssue,
} from '@flowcanvas/shared';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`API request failed with ${status}`);
  }
}

type Schema<T> = { parse(value: unknown): T };

const JSON_HEADERS = { 'content-type': 'application/json' };

async function send(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`/api${path}`, init);
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
  return res;
}

async function request<T>(schema: Schema<T>, path: string, init?: RequestInit): Promise<T> {
  return schema.parse(await (await send(path, init)).json());
}

export const listProjects = () => request(ProjectMeta.array(), '/projects');
export const getProject = (id: string) => request(ProjectMeta, `/projects/${id}`);

export const createProject = (name: string) =>
  request(ProjectMeta, '/projects', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ name }) });

export const renameProject = (id: string, name: string) =>
  request(ProjectMeta, `/projects/${id}`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ name }) });

export const deleteProject = async (id: string) => {
  await send(`/projects/${id}`, { method: 'DELETE' });
};

/** Loads and validates the canvas; migrations of older schema versions will hook in here */
export const getCanvas = (projectId: string) => request(CanvasResponse, `/projects/${projectId}/canvas`);

/* ---------- Snapshots ---------- */

export const listSnapshots = (projectId: string) => request(SnapshotMeta.array(), `/projects/${projectId}/snapshots`);

/** Checkpoints the saved canvas (save pending changes first) */
export const createSnapshot = (projectId: string, label?: string) =>
  request(SnapshotMeta, `/projects/${projectId}/snapshots`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ label: label?.trim() || undefined }),
  });

export const getSnapshot = (projectId: string, snapshotId: string) =>
  request(SnapshotDetail, `/projects/${projectId}/snapshots/${snapshotId}`);

/** The server checkpoints the current canvas first; returns the restored doc as a new version */
export const restoreSnapshot = (projectId: string, snapshotId: string) =>
  request(CanvasResponse, `/projects/${projectId}/snapshots/${snapshotId}/restore`, { method: 'POST' });

export const deleteSnapshot = async (projectId: string, snapshotId: string) => {
  await send(`/projects/${projectId}/snapshots/${snapshotId}`, { method: 'DELETE' });
};

export type SaveOutcome =
  | { type: 'saved'; version: number }
  | { type: 'conflict'; currentVersion: number }
  | { type: 'invalid'; issues: ValidationIssue[] };

/** Saves the whole doc. Expected failures (409, 400) are outcomes; anything else throws. */
export async function saveCanvas(projectId: string, body: SaveCanvas): Promise<SaveOutcome> {
  try {
    const { version } = await request(SaveCanvasResult, `/projects/${projectId}/canvas`, {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
    });
    return { type: 'saved', version };
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      return { type: 'conflict', currentVersion: CanvasConflict.parse(error.body).currentVersion };
    }
    if (error instanceof ApiError && error.status === 400) {
      const parsed = ValidationErrorBody.safeParse(error.body);
      if (parsed.success) return { type: 'invalid', issues: parsed.data.issues };
    }
    throw error;
  }
}

/** Keepalive requests are capped at 64 KB by browsers */
const KEEPALIVE_LIMIT = 60_000;

/** Best-effort save while the page unloads. Returns false if the doc is too large to try. */
export function saveCanvasOnUnload(projectId: string, body: SaveCanvas): boolean {
  const json = JSON.stringify(body);
  if (new Blob([json]).size > KEEPALIVE_LIMIT) return false;
  void fetch(`/api/projects/${projectId}/canvas`, { method: 'PUT', headers: JSON_HEADERS, body: json, keepalive: true });
  return true;
}
