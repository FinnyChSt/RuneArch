import { groupImportWarnings, type ApiModel, type CanvasDoc, type ImportedApi, type ImportWarning, type OpenApiImportResult } from '@flowcanvas/shared';
import { TriangleAlert } from 'lucide-react';
import type { ApiImportResult } from '../store/apiImportOps';
import { MethodBadge } from '../components/MethodBadge';

/** Lists longer than this end in "and N more", so huge specs (thousands of items) stay fast */
const LIST_LIMIT = 100;

const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;

export type OpenApiPreviewState = { parsed: OpenApiImportResult; result: (ApiImportResult & { api: ImportedApi }) | null } | null;

/** What an OpenAPI import will do: counts, the endpoints and models it adds or updates, what it leaves, warnings by kind */
export function OpenApiPreview({ preview, doc }: { preview: OpenApiPreviewState; doc: CanvasDoc }) {
  if (!preview) return <p className="text-text-muted">Paste an OpenAPI 3.0 or 3.1 document (YAML or JSON), or open a file.</p>;
  if (!preview.parsed.ok || !preview.result) {
    return (
      <p className="flex items-start gap-1.5 text-danger">
        <TriangleAlert className="mt-0.5 size-3.5 shrink-0" /> {preview.parsed.ok ? 'Nothing to import' : preview.parsed.error}
      </p>
    );
  }
  const { api, endpoints, models, missing, settingsChanged, warnings, issues, doc: next } = preview.result;
  const endpointNodes = next.nodes.filter((n) => n.type === 'endpoint');
  const byId = new Map(endpointNodes.map((n) => [n.id, n]));
  const modelById = new Map([...doc.models, ...next.models].map((m) => [m.id, m]));
  const changedEndpoints = [...endpoints.added, ...endpoints.updated].flatMap((id) => byId.get(id) ?? []);
  const changedModels = [...models.added, ...models.updated].flatMap((id) => modelById.get(id) ?? []);

  return (
    <div className="grid gap-3">
      <p className="font-medium">
        {api.settings.title} <span className="text-text-muted">{api.settings.version} · OpenAPI {api.version}</span>
      </p>
      <ul className="grid gap-0.5">
        <li>
          Endpoints: <strong>{endpoints.added.length}</strong> new, <strong>{endpoints.updated.length}</strong> updated,{' '}
          {endpoints.unchanged.length} unchanged
        </li>
        <li>
          Models: <strong>{models.added.length}</strong> new, <strong>{models.updated.length}</strong> updated, {models.unchanged.length}{' '}
          unchanged
        </li>
        {settingsChanged && <li>API title, version, servers and auth are replaced</li>}
      </ul>

      {issues.length > 0 && (
        <div className="grid gap-1 text-danger">
          <p className="flex items-center gap-1.5 font-medium">
            <TriangleAlert className="size-3.5 shrink-0" /> The result would break canvas rules
          </p>
          <ul className="grid gap-0.5">
            {issues.slice(0, LIST_LIMIT).map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </div>
      )}

      {changedEndpoints.length > 0 && (
        <Section title="Endpoints">
          {changedEndpoints.slice(0, LIST_LIMIT).map((n) =>
            n.type === 'endpoint' ? (
              <li key={n.id} className="flex items-center gap-2 font-mono">
                <MethodBadge method={n.data.method} />
                <span className="min-w-0 flex-1 truncate">{n.data.path}</span>
                <Badge isNew={endpoints.added.includes(n.id)} />
              </li>
            ) : null,
          )}
          <More shown={LIST_LIMIT} total={changedEndpoints.length} />
        </Section>
      )}

      {changedModels.length > 0 && (
        <Section title="Models">
          {changedModels.slice(0, LIST_LIMIT).map((m: ApiModel) => (
            <li key={m.id} className="flex items-center gap-2 font-mono">
              <span className="min-w-0 flex-1 truncate">{m.name}</span>
              <span className="text-text-muted">{plural(m.fields.length, 'field')}</span>
              <Badge isNew={models.added.includes(m.id)} />
            </li>
          ))}
          <More shown={LIST_LIMIT} total={changedModels.length} />
        </Section>
      )}

      {missing.endpoints.length + missing.models.length > 0 && (
        <Section title="Not in the spec (kept)">
          {missing.endpoints.slice(0, LIST_LIMIT).map((id) => {
            const n = doc.nodes.find((node) => node.id === id);
            return n?.type === 'endpoint' ? (
              <li key={id} className="flex items-center gap-2 font-mono text-text-muted">
                <MethodBadge method={n.data.method} />
                <span className="min-w-0 flex-1 truncate">{n.data.path}</span>
              </li>
            ) : null;
          })}
          {missing.models.slice(0, LIST_LIMIT).map((id) => (
            <li key={id} className="font-mono text-text-muted">
              {modelById.get(id)?.name}
            </li>
          ))}
        </Section>
      )}

      <WarningGroups warnings={warnings} />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="grid gap-1">
      <h3 className="font-medium text-text-muted">{title}</h3>
      <ul className="grid gap-1">{children}</ul>
    </section>
  );
}

const Badge = ({ isNew }: { isNew: boolean }) => (
  <span className={`rounded px-1 ${isNew ? 'bg-node-be/20 text-node-be' : 'bg-accent/15 text-accent'}`}>{isNew ? 'new' : 'update'}</span>
);

const More = ({ shown, total }: { shown: number; total: number }) =>
  total > shown ? <li className="text-text-muted">and {(total - shown).toLocaleString()} more</li> : null;

/** One collapsed row per kind with its count; opening it lists the warnings */
function WarningGroups({ warnings }: { warnings: ImportWarning[] }) {
  const groups = groupImportWarnings(warnings);
  if (groups.length === 0) return null;
  return (
    <section aria-label="Warnings" className="grid gap-1 text-warning">
      <h3 className="flex items-center gap-1.5 font-medium">
        <TriangleAlert className="size-3.5 shrink-0" /> {plural(warnings.length, 'warning')}
      </h3>
      {groups.map((g) => (
        <details key={g.kind} className="rounded border border-border px-2 py-1">
          <summary className="cursor-pointer">
            {g.title} · {g.warnings.length.toLocaleString()}
          </summary>
          <ul className="mt-1 grid gap-0.5 text-text-muted">
            {g.warnings.slice(0, LIST_LIMIT).map((w) => (
              <li key={w.text}>{w.text}</li>
            ))}
            <More shown={LIST_LIMIT} total={g.warnings.length} />
          </ul>
        </details>
      ))}
    </section>
  );
}
