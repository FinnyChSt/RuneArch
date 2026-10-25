import { CanvasDoc } from './canvas';
import { toMermaidFlowchart } from './canvas-mermaid';
import { canvasToSvg, type CanvasSvgOptions } from './canvas-svg';

/*
 * Whole-canvas exports. Like SCHEMA_EXPORTS, the registry drives the export dialog and
 * `GET /projects/:id/canvas.<extension>`, so a new format is one entry.
 */

/** Marks a RuneArch file, so an import can tell it from a bare document */
export const CANVAS_FILE_FORMAT = 'flowcanvas';

/** The document as a RuneArch file: `{ format, schemaVersion, doc }` */
export const toCanvasJson = (doc: CanvasDoc) =>
  `${JSON.stringify({ format: CANVAS_FILE_FORMAT, schemaVersion: doc.schemaVersion, doc }, null, 2)}\n`;

export type CanvasExportOptions = CanvasSvgOptions;

export type CanvasExport = {
  label: string;
  /** File extension, also the export URL suffix */
  extension: string;
  mimeType: string;
  /** Whether `flowId` changes the output */
  flowAware: boolean;
  render(doc: CanvasDoc, options?: CanvasExportOptions): string;
};

export const CANVAS_EXPORTS = {
  svg: { label: 'SVG image', extension: 'svg', mimeType: 'image/svg+xml', flowAware: true, render: canvasToSvg },
  mermaid: {
    label: 'Mermaid',
    extension: 'mmd',
    mimeType: 'text/vnd.mermaid',
    flowAware: true,
    render: (doc, options) => toMermaidFlowchart(doc, options),
  },
  json: { label: 'JSON', extension: 'json', mimeType: 'application/json', flowAware: false, render: toCanvasJson },
} as const satisfies Record<string, CanvasExport>;

export type CanvasExportFormat = keyof typeof CANVAS_EXPORTS;

export const canvasExportByExtension = (extension: string): CanvasExport | undefined =>
  Object.values(CANVAS_EXPORTS).find((f) => f.extension === extension);

export type CanvasFileResult =
  | { ok: true; doc: CanvasDoc }
  | { ok: false; error: string; issues: string[] };

/**
 * Reads a RuneArch JSON file (or a bare document) and validates it with every doc rule. Only
 * schema version 1 exists; a later version gets a migration here.
 */
export function parseCanvasFile(text: string): CanvasFileResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `Not valid JSON: ${(e as Error).message}`, issues: [] };
  }
  const file = data as { format?: unknown; schemaVersion?: unknown; doc?: unknown };
  const raw = file && typeof file === 'object' && file.format === CANVAS_FILE_FORMAT ? file.doc : data;
  const version = (raw as { schemaVersion?: unknown } | null)?.schemaVersion;
  if (version !== undefined && version !== 1)
    return { ok: false, error: `This file is schema version ${String(version)}; this app reads version 1`, issues: [] };
  const result = CanvasDoc.safeParse(raw);
  if (!result.success)
    return {
      ok: false,
      error: 'The file is not a valid RuneArch document',
      issues: result.error.issues.slice(0, 8).map((i) => `${i.path.join('.') || '(document)'}: ${i.message}`),
    };
  return { ok: true, doc: result.data };
}
