import type { CanvasDoc, Flow } from '@flowcanvas/shared';
import { replaceFlow } from '../store/docOps';
import type { IssueMapper } from './validation';

export type FlowDraft = {
  name: string;
  color: string;
  description: string;
  steps: { edgeId: string; note: string }[];
};

export const toFlowDraft = (flow: Flow): FlowDraft => ({
  name: flow.name,
  color: flow.color ?? '',
  description: flow.description ?? '',
  steps: flow.steps.map((s) => ({ edgeId: s.edgeId, note: s.note ?? '' })),
});

export const fromFlowDraft = (flow: Flow, draft: FlowDraft): Flow => ({
  ...flow,
  name: draft.name.trim(),
  color: draft.color || undefined,
  description: draft.description.trim() || undefined,
  steps: draft.steps.map((s) => ({ edgeId: s.edgeId, note: s.note.trim() || undefined })),
});

export const buildFlowDoc = (flow: Flow) => (doc: CanvasDoc, draft: FlowDraft) => replaceFlow(doc, fromFlowDraft(flow, draft));

/** Step problems (order, repeats) show on the step row */
export const flowMapper: IssueMapper = {
  node: ([key, index]) => {
    if (key === 'name' || key === 'description') return key;
    if (key === 'steps' && typeof index === 'number') return `steps.${index}.edgeId`;
    return null;
  },
};
