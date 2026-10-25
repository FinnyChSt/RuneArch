import type { CanvasDoc } from '../canvas';
import type { ZipEntry } from '../zip';
import { toDrizzle } from './drizzle';
import { fastApiPackage, toFastApi } from './fastapi';
import { toPrisma } from './prisma';
import type { CodegenOptions } from './options';
import { toPydantic } from './pydantic';
import { toSqlAlchemy } from './sqlalchemy';
import { toSqlModel } from './sqlmodel';
import { toZod } from './zod';

export { toDrizzle } from './drizzle';
export { fastApiPackage, toFastApi } from './fastapi';
export { toPrisma } from './prisma';
export type { CodegenOptions } from './options';
export { toPydantic } from './pydantic';
export { toSqlAlchemy } from './sqlalchemy';
export { toSqlModel } from './sqlmodel';
export { toZod } from './zod';

/* ------------------------------------------------------------
 * Registry: one entry per code target. The code dialog and `GET /projects/:id/code/<target>`
 * are driven by it, so a new generator (e.g. Zod, Drizzle, Prisma) is one entry.
 * ------------------------------------------------------------ */

export type CodeExport = {
  label: string;
  /** What the code is generated from: the API models, the tables or the endpoints */
  source: 'models' | 'tables' | 'endpoints';
  /** Download file name */
  fileName: string;
  language: 'python' | 'typescript' | 'prisma';
  mimeType: string;
  render(doc: CanvasDoc, options?: CodegenOptions): string;
};

export const CODE_EXPORTS = {
  pydantic: { label: 'Pydantic', source: 'models', fileName: 'schemas.py', language: 'python', mimeType: 'text/x-python', render: toPydantic },
  sqlalchemy: { label: 'SQLAlchemy', source: 'tables', fileName: 'models.py', language: 'python', mimeType: 'text/x-python', render: toSqlAlchemy },
  sqlmodel: { label: 'SQLModel', source: 'tables', fileName: 'models.py', language: 'python', mimeType: 'text/x-python', render: toSqlModel },
  fastapi: { label: 'FastAPI', source: 'endpoints', fileName: 'main.py', language: 'python', mimeType: 'text/x-python', render: toFastApi },
  zod: { label: 'Zod', source: 'models', fileName: 'schemas.ts', language: 'typescript', mimeType: 'text/typescript', render: toZod },
  drizzle: { label: 'Drizzle', source: 'tables', fileName: 'schema.ts', language: 'typescript', mimeType: 'text/typescript', render: toDrizzle },
  prisma: { label: 'Prisma', source: 'tables', fileName: 'schema.prisma', language: 'prisma', mimeType: 'text/plain', render: toPrisma },
} as const satisfies Record<string, CodeExport>;

export type CodeTarget = keyof typeof CODE_EXPORTS;

export const CODE_TARGETS = Object.keys(CODE_EXPORTS) as CodeTarget[];

export const codeExportByTarget = (target: string): CodeExport | undefined =>
  Object.hasOwn(CODE_EXPORTS, target) ? CODE_EXPORTS[target as CodeTarget] : undefined;

/** Whether the doc has anything a code source generates from */
export const hasCodeSource = (doc: Pick<CanvasDoc, 'nodes' | 'models'>, source: CodeExport['source']) =>
  source === 'models' ? doc.models.length > 0 : doc.nodes.some((n) => n.type === (source === 'tables' ? 'table' : 'endpoint'));

/* ------------------------------------------------------------
 * Multi-file outputs, downloaded as a zip (`zipFiles`). The code dialog and
 * `GET /projects/:id/code/<package>.zip` are driven by this registry.
 * ------------------------------------------------------------ */

export type CodeFile = ZipEntry;

export type CodePackage = {
  label: string;
  /** The single-file target this package lays out as a project (the dialog's "Project" layout); none = a bundle of targets */
  target?: CodeTarget;
  /** Download file name */
  fileName: string;
  files(doc: CanvasDoc, options?: CodegenOptions): CodeFile[];
};

/** Every target with something to generate from, each in its own folder: `pydantic/schemas.py`, `prisma/schema.prisma` */
const allTargets = (doc: CanvasDoc, options?: CodegenOptions): CodeFile[] =>
  CODE_TARGETS.filter((t) => hasCodeSource(doc, CODE_EXPORTS[t].source)).map((t) => ({
    path: `${t}/${CODE_EXPORTS[t].fileName}`,
    content: CODE_EXPORTS[t].render(doc, options),
  }));

export const CODE_PACKAGES = {
  fastapi: { label: 'FastAPI project', target: 'fastapi', fileName: 'fastapi-app.zip', files: fastApiPackage },
  all: { label: 'All targets', fileName: 'code.zip', files: allTargets },
} as const satisfies Record<string, CodePackage>;

export type CodePackageName = keyof typeof CODE_PACKAGES;

export const CODE_PACKAGE_NAMES = Object.keys(CODE_PACKAGES) as CodePackageName[];

export const codePackageByName = (name: string): CodePackage | undefined =>
  Object.hasOwn(CODE_PACKAGES, name) ? CODE_PACKAGES[name as CodePackageName] : undefined;
