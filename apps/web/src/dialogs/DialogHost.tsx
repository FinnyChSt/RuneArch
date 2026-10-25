import type { ApiModel, CanvasEdge, CanvasNode, Feature, Flow } from '@flowcanvas/shared';
import { lazy, Suspense, useEffect, useState } from 'react';
import { FeatureDialog } from '../features/FeatureDialog';
import { FeatureExportDialog } from '../features/FeatureExportDialog';
import { FlowDialog } from '../flows/FlowDialog';
import { useCanvasStore } from '../store/canvasStore';
import { useUiStore, type Dialog } from '../store/uiStore';
import { ComponentDialog } from './ComponentDialog';
import { EdgeDialog } from './EdgeDialog';
import { EndpointDialog } from './EndpointDialog';
import { FrameDialog } from './FrameDialog';
import { JobDialog } from './JobDialog';
import { ModelDialog } from './ModelDialog';
import { newModel } from './modelDraft';
import { ScreenDialog } from './ScreenDialog';
import { ServiceDialog } from './ServiceDialog';
import { TableDialog } from './TableDialog';

// CodeMirror is large; load the spec, schema, code, screens and export previews only when they're opened
const SpecDialog = lazy(() => import('../spec/SpecDialog'));
const SchemaDialog = lazy(() => import('../spec/SchemaDialog'));
const CodeDialog = lazy(() => import('../spec/CodeDialog'));
const ScreensDialog = lazy(() => import('../spec/ScreensDialog'));
const ExportDialog = lazy(() => import('../spec/ExportDialog'));
const ImportDialog = lazy(() => import('../spec/ImportDialog'));
const SnapshotDialog = lazy(() => import('../history/SnapshotDialog'));

/** Dialogs that don't edit a doc item (or create a new one) */
const NO_TARGET = Symbol('no target');

type Target = CanvasNode | CanvasEdge | Flow | Feature | ApiModel | typeof NO_TARGET | undefined;

/** The doc item a dialog edits; undefined when it no longer exists */
function resolve(doc: ReturnType<typeof useCanvasStore.getState>['doc'], dialog: Dialog): Target {
  switch (dialog.kind) {
    case 'flow':
      return doc.flows.find((f) => f.id === dialog.id);
    case 'feature':
    case 'featureExport':
      return doc.features.find((f) => f.id === dialog.id);
    case 'model':
      return dialog.id ? doc.models.find((m) => m.id === dialog.id) : NO_TARGET;
    case 'edge':
      return doc.edges.find((e) => e.id === dialog.id);
    case 'spec':
    case 'schema':
    case 'code':
    case 'screens':
    case 'export':
    case 'import':
    case 'snapshot':
      return NO_TARGET;
    default:
      return dialog.id ? doc.nodes.find((n) => n.id === dialog.id) : undefined;
  }
}

/** Renders the dialog named in uiStore.dialog */
export function DialogHost() {
  const dialog = useUiStore((s) => s.dialog);
  const closeDialog = useUiStore((s) => s.closeDialog);
  const target = useCanvasStore((s) => (dialog ? resolve(s.doc, dialog) : undefined));

  // The edited item can vanish underneath an open dialog (e.g. "Reload latest" after a conflict)
  const missing = dialog !== null && target === undefined;
  useEffect(() => {
    if (missing) closeDialog();
  }, [missing, closeDialog]);

  if (!dialog || target === undefined) return null;
  const close = closeDialog;

  if (dialog.kind === 'spec')
    return (
      <Suspense fallback={null}>
        <SpecDialog onClose={close} />
      </Suspense>
    );
  if (dialog.kind === 'schema')
    return (
      <Suspense fallback={null}>
        <SchemaDialog onClose={close} />
      </Suspense>
    );
  if (dialog.kind === 'code')
    return (
      <Suspense fallback={null}>
        <CodeDialog onClose={close} />
      </Suspense>
    );
  if (dialog.kind === 'snapshot' && dialog.id)
    return (
      <Suspense fallback={null}>
        <SnapshotDialog key={dialog.id} snapshotId={dialog.id} onClose={close} />
      </Suspense>
    );
  if (dialog.kind === 'import')
    return (
      <Suspense fallback={null}>
        <ImportDialog onClose={close} />
      </Suspense>
    );
  if (dialog.kind === 'export')
    return (
      <Suspense fallback={null}>
        <ExportDialog onClose={close} />
      </Suspense>
    );
  if (dialog.kind === 'screens')
    return (
      <Suspense fallback={null}>
        <ScreensDialog onClose={close} />
      </Suspense>
    );
  if (dialog.kind === 'model')
    return target === NO_TARGET ? <NewModelDialog onClose={close} /> : <ModelDialog key={(target as ApiModel).id} model={target as ApiModel} isNew={false} onClose={close} />;
  if (dialog.kind === 'flow') return <FlowDialog key={(target as Flow).id} flow={target as Flow} onClose={close} />;
  if (dialog.kind === 'feature')
    return <FeatureDialog key={(target as Feature).id} feature={target as Feature} onClose={close} />;
  if (dialog.kind === 'featureExport')
    return <FeatureExportDialog key={(target as Feature).id} feature={target as Feature} onClose={close} />;
  if (dialog.kind === 'edge') {
    const edge = target as CanvasEdge;
    return edge.kind === 'fk' ? null : <EdgeDialog key={edge.id} edge={edge} onClose={close} />;
  }

  // Node dialogs, keyed by node id: a fresh draft for every node
  const node = target as CanvasNode;
  switch (node.type) {
    case 'screen':
      return <ScreenDialog key={node.id} node={node} onClose={close} />;
    case 'component':
      return <ComponentDialog key={node.id} node={node} onClose={close} />;
    case 'frame':
      return <FrameDialog key={node.id} node={node} onClose={close} />;
    case 'service':
      return <ServiceDialog key={node.id} node={node} onClose={close} />;
    case 'job':
      return <JobDialog key={node.id} node={node} onClose={close} />;
    case 'endpoint':
      return <EndpointDialog key={node.id} node={node} onClose={close} />;
    case 'table':
      return <TableDialog key={node.id} node={node} focusColumnId={dialog.focusColumnId} onClose={close} />;
    default:
      return null;
  }
}

function NewModelDialog({ onClose }: { onClose(): void }) {
  const [model] = useState(newModel);
  return <ModelDialog model={model} isNew onClose={onClose} />;
}
