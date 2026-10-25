import { CanvasDoc, type CanvasEdge } from '@flowcanvas/shared';

type Path = readonly PropertyKey[];

/** Maps CanvasDoc issues to form field names ('label', 'columns.2.name', ...) */
export type IssueMapper = {
  /** Issue inside the edited node, edge or flow; `path` is relative to it. null = show as a general error. */
  node(path: Path): string | null;
  /** Issue on an edge; return a field to claim it, or null if it doesn't concern this dialog */
  edge?(edge: CanvasEdge, path: Path): string | null;
};

export type DraftIssues = {
  /** First message per field */
  fields: Record<string, string>;
  /** Issues about this node that no field owns */
  other: string[];
};

export type DraftSection = 'nodes' | 'edges' | 'flows' | 'models';

/**
 * Validates a candidate doc (the current doc with the draft applied) with the shared schema,
 * so doc-wide rules (duplicate routes, unique table names, FK columns) show inline too.
 * Only issues about the edited node or flow (and edges the mapper claims) are reported.
 */
export function validateDraft(
  candidate: CanvasDoc,
  id: string,
  mapper: IssueMapper,
  target: DraftSection = 'nodes',
): DraftIssues {
  const issues: DraftIssues = { fields: {}, other: [] };
  // Duplicate checks (routes, table and model names) flag the later item. Validate with the edited
  // item last so a clash it causes is reported on it, not on the item it collides with.
  const items: readonly { id: string }[] = candidate[target];
  const edited = items.find((item) => item.id === id);
  const ordered = edited ? { ...candidate, [target]: [...items.filter((item) => item !== edited), edited] } : candidate;
  const result = CanvasDoc.safeParse(ordered);
  if (result.success) return issues;

  for (const issue of result.error.issues) {
    const [section, index, ...rest] = issue.path;
    if (typeof index !== 'number') continue;

    let field: string | null;
    if (section === target) {
      if ((ordered[target] as readonly { id: string }[])[index]?.id !== id) continue;
      field = mapper.node(rest);
    } else if (section === 'edges' && mapper.edge) {
      const edge = candidate.edges[index];
      field = edge ? mapper.edge(edge, rest) : null;
      if (!field) continue;
    } else {
      continue;
    }

    if (field) issues.fields[field] ??= issue.message;
    else issues.other.push(issue.message);
  }
  return issues;
}

export const hasIssues = (issues: DraftIssues) => issues.other.length > 0 || Object.keys(issues.fields).length > 0;
