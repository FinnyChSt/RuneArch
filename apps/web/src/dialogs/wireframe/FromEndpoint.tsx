import type { ApiModel } from '@flowcanvas/shared';
import { X } from 'lucide-react';
import { useState } from 'react';
import { nodeTitle } from '../../canvas/flowView';
import type { NodeOf } from '../../canvas/mapping';
import { Button, compactControlClass, IconAction } from '../../components/ui/form';
import { endpointSources } from './fromApi';

export type GenerateKind = 'form' | 'list' | 'table';

type Props = {
  endpoints: readonly NodeOf<'endpoint'>[];
  models: readonly ApiModel[];
  onGenerate(kind: GenerateKind, endpoint: NodeOf<'endpoint'>): void;
  onClose(): void;
};

/** "From endpoint": pick an endpoint, then add a form for its request body or a list/table for its response */
export function FromEndpoint({ endpoints, models, onGenerate, onClose }: Props) {
  const [endpointId, setEndpointId] = useState(endpoints[0]?.id ?? '');
  const endpoint = endpoints.find((e) => e.id === endpointId);
  const sources = endpoint && endpointSources(endpoint, models);

  return (
    <div role="group" aria-label="Generate from endpoint" className="grid gap-2 rounded-lg border border-border bg-surface p-3">
      <div className="flex flex-wrap items-center gap-2">
        {endpoints.length > 0 ? (
          <>
            <select
              aria-label="Endpoint"
              value={endpointId}
              onChange={(e) => setEndpointId(e.target.value)}
              className={`${compactControlClass} font-mono`}
            >
              {endpoints.map((e) => (
                <option key={e.id} value={e.id}>
                  {nodeTitle(e)}
                </option>
              ))}
            </select>
            <Button
              disabled={!sources?.request.model}
              title={sources?.request.model ? undefined : sources?.request.reason}
              onClick={() => endpoint && onGenerate('form', endpoint)}
            >
              Form
            </Button>
            {(['list', 'table'] as const).map((kind) => (
              <Button
                key={kind}
                disabled={!sources?.response.model}
                title={sources?.response.model ? undefined : sources?.response.reason}
                onClick={() => endpoint && onGenerate(kind, endpoint)}
              >
                {kind === 'list' ? 'List' : 'Table'}
              </Button>
            ))}
          </>
        ) : (
          <p className="text-xs text-text-muted">Add an endpoint to the canvas to generate from it.</p>
        )}
        <span className="ml-auto">
          <IconAction label="Close generator" onClick={onClose}>
            <X className="size-3.5" />
          </IconAction>
        </span>
      </div>
      {sources && (
        <p className="text-xs text-text-muted">
          Form: {sources.request.model ? `fields of ${sources.request.model.name}` : sources.request.reason}. List / table:{' '}
          {sources.response.model ? `rows of ${sources.response.model.name}` : sources.response.reason}.
        </p>
      )}
    </div>
  );
}
