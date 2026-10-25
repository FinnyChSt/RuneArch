import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  MiniMap,
  ReactFlow,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type FinalConnectionState,
  type IsValidConnection,
  type NodeChange,
  type Viewport,
} from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react';
import { openNodeDialog } from '../dialogs/openNodeDialog';
import { useFeatureView } from '../hooks/useFeatureView';
import { useFollowPlayhead } from '../hooks/useFollowPlayhead';
import { useShortcuts } from '../hooks/useShortcuts';
import { useCanvasStore } from '../store/canvasStore';
import { isNodeTool, useUiStore } from '../store/uiStore';
import { checkArrow, checkConnection, touchesTable } from './connectRules';
import { ContextMenu } from './ContextMenu';
import { ForeignKeyEdge, ForeignKeyMarkers } from './edges/ForeignKeyEdge';
import { LinkEdge } from './edges/LinkEdge';
import { FIT_VIEW_OPTIONS } from './fitView';
import { unshippedIds } from './featureView';
import { flowView } from './flowView';
import { createNodeMapper, NODE_GROUP, toFlowEdges, type FlowEdge, type FlowNode } from './mapping';
import { nodeTypes } from './nodes';
import { PenLayer } from './PenLayer';
import { SelectionBar } from './SelectionBar';

const edgeTypes = { link: LinkEdge, fk: ForeignKeyEdge };

const GROUP_COLOR = { fe: 'var(--node-fe)', be: 'var(--node-be)', db: 'var(--node-db)', sketch: 'var(--node-sketch)' };

export function Canvas() {
  useShortcuts();
  const { screenToFlowPosition, fitView } = useReactFlow();
  const containerRef = useRef<HTMLDivElement>(null);
  useFollowPlayhead(containerRef);

  // Fit requests (e.g. after an import): wait a frame so new nodes are measured first
  const fitRequest = useUiStore((s) => s.fitRequest);
  useEffect(() => {
    if (!fitRequest) return;
    const timer = setTimeout(() => {
      const nodes = fitRequest.nodeIds.length ? fitRequest.nodeIds.map((id) => ({ id })) : undefined;
      void fitView({ ...FIT_VIEW_OPTIONS, nodes, duration: 300 });
    }, 60);
    return () => clearTimeout(timer);
  }, [fitRequest, fitView]);

  const doc = useCanvasStore((s) => s.doc);
  const measured = useCanvasStore((s) => s.measured);
  const dragPositions = useCanvasStore((s) => s.dragPositions);
  const resizeSizes = useCanvasStore((s) => s.resizeSizes);
  const invalidIds = useCanvasStore((s) => s.invalidIds);
  const invalid = useMemo(() => new Set(invalidIds), [invalidIds]);
  const tool = useUiStore((s) => s.tool);
  const selectionList = useUiStore((s) => s.selection);
  const selection = useMemo(() => new Set(selectionList), [selectionList]);
  const activeFlowId = useUiStore((s) => s.activeFlowId);
  const recording = useUiStore((s) => s.flowRecording);
  const playhead = useUiStore((s) => s.playhead);
  const flow = useMemo(
    () => flowView(doc, activeFlowId, { playhead, recording }),
    [doc, activeFlowId, playhead, recording],
  );

  // The active flow can disappear (undo, delete, reload); drop the highlight with it
  useEffect(() => {
    if (activeFlowId && !flow) useUiStore.getState().selectFlow(null);
  }, [activeFlowId, flow]);

  // Feature highlight (see useFeatureView) and "hide unshipped"
  const viewFeatureId = useUiStore((s) => s.viewFeatureId);
  const activeFeatureId = useCanvasStore((s) => s.activeFeatureId);
  const hideUnshipped = useUiStore((s) => s.hideUnshipped);
  const feature = useFeatureView();
  const hidden = useMemo(
    () => (hideUnshipped ? unshippedIds(doc, [viewFeatureId, activeFeatureId]) : undefined),
    [doc, hideUnshipped, viewFeatureId, activeFeatureId],
  );
  useEffect(() => {
    if (viewFeatureId && !doc.features.some((f) => f.id === viewFeatureId)) useUiStore.getState().selectFeature(null);
    if (activeFeatureId && !doc.features.some((f) => f.id === activeFeatureId))
      useCanvasStore.getState().setActiveFeature(null);
  }, [doc.features, viewFeatureId, activeFeatureId]);

  const [mapNodes] = useState(createNodeMapper);
  // Open at the saved viewport. A canvas with content but no saved viewport is fitted; an empty
  // one is not, or React Flow would fit (and zoom to) the first node the user adds.
  const [opening] = useState(() => {
    const { viewport } = useCanvasStore.getState();
    const isDefault = viewport.x === 0 && viewport.y === 0 && viewport.zoom === 1;
    return { viewport, fit: isDefault && doc.nodes.length > 0 };
  });
  const nodes = useMemo(
    () => mapNodes(doc, { selection, invalid, measured, dragPositions, resizeSizes, flow, feature, hidden }),
    [mapNodes, doc, selection, invalid, measured, dragPositions, resizeSizes, flow, feature, hidden],
  );
  // FK edges pick their sides from table positions, so they follow drags too
  const edges = useMemo(
    () => toFlowEdges(doc, { selection, measured, dragPositions, flow, feature, hidden }),
    [doc, selection, measured, dragPositions, flow, feature, hidden],
  );

  const onNodesChange = useCallback((changes: NodeChange<FlowNode>[]) => {
    useCanvasStore.getState().applyNodeChanges(changes);
    useUiStore.getState().applySelectChanges(changes.filter((c) => c.type === 'select'));
  }, []);

  const onEdgesChange = useCallback((changes: EdgeChange<FlowEdge>[]) => {
    useUiStore.getState().applySelectChanges(changes.filter((c) => c.type === 'select'));
  }, []);

  const onConnect = useCallback((connection: Connection) => {
    const { connect, doc } = useCanvasStore.getState();
    const ui = useUiStore.getState();
    const arrow = ui.tool === 'arrow';
    const result = connect(connection, { arrow });
    if (!result.ok) ui.showHint(result.reason);
    else if (arrow) ui.setTool('select');
    else if (result.kind !== 'fk' && result.kind !== 'arrow' && touchesTable(doc, connection))
      ui.showHint('Double-click the connection to pick its CRUD operations');
  }, []);

  const isValidConnection = useCallback<IsValidConnection>((c) => {
    const { doc } = useCanvasStore.getState();
    return (useUiStore.getState().tool === 'arrow' ? checkArrow(doc, c) : checkConnection(doc, c)).ok;
  }, []);

  // React Flow drops invalid connections silently; tell the user why
  const onConnectEnd = useCallback((_: MouseEvent | TouchEvent, state: FinalConnectionState) => {
    if (state.isValid !== false || !state.fromNode || !state.toNode) return;
    const fromSource = state.fromHandle?.type !== 'target';
    const conn = {
      source: fromSource ? state.fromNode.id : state.toNode.id,
      target: fromSource ? state.toNode.id : state.fromNode.id,
    };
    const { doc } = useCanvasStore.getState();
    const result = useUiStore.getState().tool === 'arrow' ? checkArrow(doc, conn) : checkConnection(doc, conn);
    if (!result.ok) useUiStore.getState().showHint(result.reason);
  }, []);

  // Recording: each clicked edge becomes the next step (one undo step each)
  const onEdgeClick = useCallback((_: ReactMouseEvent, edge: FlowEdge) => {
    const ui = useUiStore.getState();
    if (!ui.flowRecording || !ui.activeFlowId) return;
    const result = useCanvasStore.getState().addFlowStep(ui.activeFlowId, edge.id);
    if (!result.ok) ui.showHint(result.reason);
  }, []);

  const onNodeDoubleClick = useCallback((_: ReactMouseEvent, node: FlowNode) => {
    openNodeDialog(node.id);
  }, []);

  // An FK edge opens its table's dialog at the referencing column; other edges their own dialog
  const onEdgeDoubleClick = useCallback((_: ReactMouseEvent, edge: FlowEdge) => {
    const e = edge.data?.edge;
    if (!e) return;
    if (e.kind === 'fk') useUiStore.getState().openDialog({ kind: 'table', id: e.source, focusColumnId: e.data.sourceColumnId });
    else useUiStore.getState().openDialog({ kind: 'edge', id: e.id });
  }, []);

  // Right-click: feature actions for the node or edge (layout and notes aren't feature items)
  const onNodeContextMenu = useCallback((e: ReactMouseEvent, node: FlowNode) => {
    e.preventDefault();
    const type = node.data.node.type;
    if (type === 'frame' || type === 'sketch') return;
    useUiStore.getState().openContextMenu({ x: e.clientX, y: e.clientY, ref: { kind: 'node', id: node.id } });
  }, []);

  const onEdgeContextMenu = useCallback((e: ReactMouseEvent, edge: FlowEdge) => {
    e.preventDefault();
    if (edge.data?.edge.kind === 'arrow') return;
    useUiStore.getState().openContextMenu({ x: e.clientX, y: e.clientY, ref: { kind: 'edge', id: edge.id } });
  }, []);

  const onMoveEnd = useCallback((_: unknown, viewport: Viewport) => {
    useCanvasStore.getState().setViewport(viewport);
  }, []);

  const onPaneClick = useCallback(
    (e: ReactMouseEvent) => {
      const ui = useUiStore.getState();
      if (!isNodeTool(ui.tool)) {
        // Clicking empty canvas leaves the flow or feature view and shows everything again (not while recording)
        if (ui.activeFlowId && !ui.flowRecording) ui.selectFlow(null);
        if (ui.viewFeatureId) ui.selectFeature(null);
        return;
      }
      const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const id = useCanvasStore.getState().addNode(ui.tool, { x: Math.round(position.x), y: Math.round(position.y) });
      ui.setSelection([id]);
      // Notes and text are for writing: start typing right away
      if (ui.tool === 'sticky' || ui.tool === 'text') ui.setEditing(id);
      ui.setTool('select');
    },
    [screenToFlowPosition],
  );

  return (
    <div
      ref={containerRef}
      className={`relative h-full w-full ${isNodeTool(tool) ? 'fc-tool-add' : ''} ${tool === 'arrow' ? 'fc-tool-arrow' : ''} ${
        recording ? 'fc-recording' : ''
      }`}
      style={feature ? ({ '--feature-color': feature.color } as CSSProperties) : undefined}
    >
      <ReactFlow<FlowNode, FlowEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectEnd={onConnectEnd}
        isValidConnection={isValidConnection}
        onPaneClick={onPaneClick}
        onNodeDoubleClick={onNodeDoubleClick}
        onEdgeClick={onEdgeClick}
        onEdgeDoubleClick={onEdgeDoubleClick}
        onNodeContextMenu={onNodeContextMenu}
        onEdgeContextMenu={onEdgeContextMenu}
        zoomOnDoubleClick={false}
        connectionMode={ConnectionMode.Strict}
        deleteKeyCode={null}
        panOnDrag={tool === 'pan' ? true : [1, 2]}
        selectionOnDrag={tool === 'select'}
        colorMode="dark"
        minZoom={0.2}
        maxZoom={2}
        fitView={opening.fit}
        fitViewOptions={FIT_VIEW_OPTIONS}
        defaultViewport={opening.viewport}
        onMoveEnd={onMoveEnd}
        proOptions={{ hideAttribution: true }}
      >
        <ForeignKeyMarkers />
        <Background variant={BackgroundVariant.Dots} gap={20} size={1.5} color="var(--grid-dot)" />
        <Controls position="bottom-right" orientation="horizontal" showInteractive={false} />
        <MiniMap<FlowNode>
          position="bottom-right"
          className="mb-14!"
          pannable
          zoomable
          nodeColor={(n) => GROUP_COLOR[NODE_GROUP[n.data.node.type]]}
        />
      </ReactFlow>
      {tool === 'pen' && <PenLayer />}
      <SelectionBar />
      <ContextMenu />

      {doc.nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="rounded-lg border border-border bg-surface/80 px-5 py-3 text-sm text-text-muted">
            Pick a tool on the left, or press <Kbd>S</Kbd> <Kbd>E</Kbd> <Kbd>T</Kbd> and click to add your first node
          </div>
        </div>
      )}
    </div>
  );
}

function Kbd({ children }: { children: string }) {
  return <kbd className="rounded border border-border bg-surface-raised px-1.5 font-mono text-xs text-text">{children}</kbd>;
}
