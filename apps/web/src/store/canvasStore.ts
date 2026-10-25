import {
  ApiModel,
  ApiSettings,
  CanvasEdge,
  CanvasNode,
  canAppendStep,
  CanvasDoc,
  convertDocDialect,
  emptyCanvas,
  Feature,
  featureById,
  Flow,
  discardFeature,
  removeFeatureItem,
  shipFeature,
  setFeatureItem,
  tagChanges,
  type DiffEntry,
  type FeatureItemRef,
  type FeatureRole,
  type SqlDialect,
  type ValidationIssue,
} from '@flowcanvas/shared';
import type { NodeChange } from '@xyflow/react';
import { temporal } from 'zundo';
import { create, useStore } from 'zustand';
import { checkArrow, checkConnection, type ConnectionInput, type ConnectResult } from '../canvas/connectRules';
import { columnIdOf, storedSourceHandle } from '../canvas/handles';
import * as ops from './docOps';
import * as featureOps from './featureOps';
import * as layout from './layoutOps';
import { createNode, createStroke, newId, type Placeable, type Position } from './nodeFactory';

export type SaveState = 'saved' | 'dirty' | 'saving' | 'conflict' | 'error';

/** Why the last save failed (saveState 'error') */
export type SaveError = { kind: 'network' } | { kind: 'invalid'; issues: ValidationIssue[] };

type Dimensions = { width: number; height: number };
type Viewport = CanvasDoc['viewport'];

type CanvasState = {
  projectId: string | null;
  /** The only source of truth for the canvas. React Flow state is derived from it. */
  doc: CanvasDoc;
  /** Server version the doc is based on (optimistic locking) */
  version: number;
  saveState: SaveState;
  saveError: SaveError | null;
  /** Server version that caused the last 409 */
  conflictVersion: number | null;
  /** Nodes named by the last validation error */
  invalidIds: string[];
  /** Live viewport. Kept out of `doc` so panning never creates undo steps or saves; sent along with each save. */
  viewport: Viewport;
  /**
   * Feature that edits are tagged in: new items become `added`, edited ones `changed` (with a
   * baseline copy), in the same undo step. Not saved, not in undo history.
   */
  activeFeatureId: string | null;

  /* Transient view state: never saved, never part of undo history */
  /** Sizes measured by React Flow; must be fed back or nodes get hidden again */
  measured: Record<string, Dimensions>;
  /** Positions while dragging; committed to `doc` once on drag stop (one undo step) */
  dragPositions: Record<string, Position>;
  /** Sizes while resizing (frames, sketches); committed once when the resize ends */
  resizeSizes: Record<string, Dimensions>;

  /** Replaces everything with a server doc: clean state, empty history */
  load(doc: CanvasDoc, version: number, projectId?: string | null): void;
  setViewport(viewport: Viewport): void;
  /** Adds a node (or sketch shape) with defaults and returns its id */
  addNode(type: Placeable, position: Position): string;
  /** Adds a pen stroke from points in flow coordinates; returns its id */
  addStroke(points: readonly (readonly [number, number, number])[]): string;
  updateNode(id: string, patch: Partial<Omit<CanvasNode, 'id' | 'type'>>): void;
  /** Commits a dialog edit as one undo step; tables also sync their FK edges from `columnRefs` */
  editNode(node: CanvasNode, columnRefs?: ops.ColumnRef[]): void;
  /** Commits a screen dialog as one undo step, syncing the edges that start at wireframe elements */
  editScreen(node: CanvasNode, links: readonly ops.ElementLink[]): void;
  removeElements(ids: Iterable<string>): void;
  applyNodeChanges(changes: NodeChange[]): void;
  /** Connects two nodes; `arrow` skips the connect rules' kind and draws a plain arrow */
  connect(connection: ConnectionInput, options?: { arrow?: boolean }): ConnectResult;
  /** Commits an edge dialog edit as one undo step */
  editEdge(edge: CanvasEdge): void;
  /** Duplicates nodes (and edges between them); returns the ids of the copies */
  duplicate(ids: Iterable<string>): string[];
  /** Rendered size of a node: stored, being resized, or measured */
  sizeOf(node: CanvasNode): Dimensions;
  /** Moves nodes to absolute canvas positions (align, distribute, auto-layout), one undo step */
  arrange(positions: Record<string, Position>): void;
  /** Wraps nodes in a new frame; returns its id (null if nothing could be grouped) */
  group(ids: Iterable<string>): string | null;
  /** Removes frames, keeping their children in place */
  ungroup(ids: Iterable<string>): void;
  /** Replaces the doc with an imported one (a schema merged in, or a whole JSON file), validated, one undo step */
  applyImport(doc: CanvasDoc): void;

  /** Creates an empty flow (recorded afterwards) and returns its id */
  addFlow(input: { name: string; color?: string; description?: string }): string;
  /** Replaces a flow, e.g. from the flow dialog */
  saveFlow(flow: Flow): void;
  removeFlow(id: string): void;
  /** Adds or replaces an API model (one undo step) */
  upsertModel(model: ApiModel): void;
  /** Removes a model; callers check modelUsages first so no reference dangles */
  removeModel(id: string): void;
  updateApiSettings(settings: ApiSettings): void;
  /** Switches the project database, converting column types and defaults (one undo step) */
  setDatabaseDialect(dialect: SqlDialect): void;
  /** Appends a recorded step if the flow can continue with this edge */
  addFlowStep(flowId: string, edgeId: string): { ok: true } | { ok: false; reason: string };

  /** Creates a feature and returns its id */
  addFeature(input: { name: string; color?: string; description?: string }): string;
  /** Replaces a feature, e.g. from the feature dialog */
  saveFeature(feature: Feature): void;
  removeFeature(id: string): void;
  /** Tags edits in this feature from now on (null: none) */
  setActiveFeature(id: string | null): void;
  /**
   * Puts an item into a feature with a role, e.g. "add as existing" (`uses`). Marking an item
   * `changed` keeps its current version as baseline; an item `added` elsewhere moves here.
   */
  setFeatureItem(featureId: string, ref: FeatureItemRef, role: FeatureRole): void;
  removeFeatureItem(featureId: string, ref: FeatureItemRef): void;
  /** Undoes one change of a changed item from the feature's baseline (one undo step); `reason` explains a refusal */
  revertFeatureEntry(featureId: string, ref: FeatureItemRef, entry: DiffEntry): { ok: true } | { ok: false; reason: string };
  /** Puts a changed item back as it was before the feature (one undo step) */
  revertFeatureItem(featureId: string, ref: FeatureItemRef): { ok: true } | { ok: false; reason: string };
  /**
   * Ships a feature: deletes what it removes, keeps its work as the plain project, marks it shipped
   * (one undo step). `warnings` say what didn't go as planned; nothing blocks.
   */
  shipFeature(featureId: string): { ok: true; warnings: string[] } | { ok: false; reason: string };
  /** Discards a feature: deletes what it adds, restores what it changes, deletes the feature (one undo step) */
  discardFeature(featureId: string): { ok: true; warnings: string[] } | { ok: false; reason: string };
};

let loading = false;
/** Nodes moved or resized by the resize in progress (see applyNodeChanges) */
const resizeSession = new Set<string>();
/** Size of a node React Flow hasn't measured yet */
const DEFAULT_SIZE: Dimensions = { width: 200, height: 80 };

export const useCanvasStore = create<CanvasState>()(
  temporal(
    (set, get) => {
      /**
       * Replaces the doc if it changed; each call is one undo step. Changes are tagged in the
       * active feature unless `tag` is false (project-wide transforms like a dialect switch).
       */
      const commit = (doc: CanvasDoc, { tag = true } = {}) => {
        const prev = get().doc;
        if (doc === prev) return;
        const { activeFeatureId } = get();
        set({ doc: tag && activeFeatureId ? tagChanges(prev, doc, activeFeatureId) : doc });
      };

      return {
        projectId: null,
        doc: emptyCanvas(),
        version: 0,
        saveState: 'saved',
        saveError: null,
        conflictVersion: null,
        invalidIds: [],
        viewport: emptyCanvas().viewport,
        activeFeatureId: null,
        measured: {},
        dragPositions: {},
        resizeSizes: {},

        load: (doc, version, projectId = null) => {
          loading = true;
          set({
            doc,
            version,
            projectId,
            saveState: 'saved',
            saveError: null,
            conflictVersion: null,
            invalidIds: [],
            viewport: doc.viewport,
            activeFeatureId: null,
            measured: {},
            dragPositions: {},
            resizeSizes: {},
          });
          loading = false;
          useCanvasStore.temporal.getState().clear();
        },

        setViewport: (viewport) => set({ viewport }),

        addNode: (type, position) => {
          const node = createNode(get().doc, type, position);
          commit(ops.addNode(get().doc, node));
          return node.id;
        },

        addStroke: (points) => {
          const node = createStroke(points);
          commit(ops.addNode(get().doc, node));
          return node.id;
        },

        updateNode: (id, patch) => {
          const node = get().doc.nodes.find((n) => n.id === id);
          if (!node) return;
          commit(ops.replaceNode(get().doc, CanvasNode.parse({ ...node, ...patch })));
        },

        editNode: (node, columnRefs) => {
          const parsed = CanvasNode.parse(node);
          const { doc } = get();
          commit(
            parsed.type === 'table' && columnRefs
              ? ops.applyTableEdit(doc, parsed, columnRefs)
              : ops.replaceNode(doc, parsed),
          );
        },

        editScreen: (node, links) => {
          const parsed = CanvasNode.parse(node);
          if (parsed.type === 'screen') commit(ops.applyScreenEdit(get().doc, parsed, links));
        },

        removeElements: (ids) => commit(ops.removeElements(get().doc, ids)),

        applyNodeChanges: (changes) => {
          let { measured, dragPositions, resizeSizes } = get();
          const committed: Record<string, Position> = {};
          const sizes: Record<string, Dimensions> = {};
          let hasCommit = false;
          let dropped = false;

          for (const c of changes) {
            if (c.type === 'dimensions' && c.dimensions && c.resizing === true) {
              resizeSizes = { ...resizeSizes, [c.id]: c.dimensions };
              resizeSession.add(c.id);
            } else if (c.type === 'dimensions' && c.dimensions && c.resizing === false) {
              // End of a resize: its size and the positions it moved (its own, and children kept in place) commit together
              sizes[c.id] = c.dimensions;
              for (const id of resizeSession) {
                if (id in dragPositions) committed[id] = dragPositions[id]!;
                const { [id]: _, ...rest } = dragPositions;
                dragPositions = rest;
              }
              resizeSession.clear();
              const { [c.id]: _, ...rest } = resizeSizes;
              resizeSizes = rest;
              hasCommit = true;
            } else if (c.type === 'dimensions' && c.dimensions) {
              const prev = measured[c.id];
              if (prev?.width !== c.dimensions.width || prev?.height !== c.dimensions.height)
                measured = { ...measured, [c.id]: c.dimensions };
            } else if (c.type === 'position') {
              if (c.dragging || (resizeSession.size > 0 && c.dragging === undefined)) {
                // Resizers report positions without `dragging`; they're transient until the resize ends
                if (c.position) dragPositions = { ...dragPositions, [c.id]: c.position };
                if (!c.dragging) resizeSession.add(c.id);
              } else {
                const p = c.position ?? dragPositions[c.id];
                if (p) {
                  committed[c.id] = p;
                  hasCommit = true;
                  dropped = true;
                }
                if (c.id in dragPositions) {
                  const { [c.id]: _, ...rest } = dragPositions;
                  dragPositions = rest;
                }
              }
            }
            // `select` goes to uiStore; `remove` is handled by our own shortcuts
          }

          const s = get();
          if (measured !== s.measured || dragPositions !== s.dragPositions || resizeSizes !== s.resizeSizes)
            set({ measured, dragPositions, resizeSizes });
          if (!hasCommit) return;
          let doc = ops.resizeNodes(ops.moveNodes(get().doc, committed), sizes);
          // A dropped node joins the frame it lands in (or leaves the one it was dragged out of)
          if (dropped) doc = layout.dropIntoFrames(doc, Object.keys(committed), get().sizeOf);
          commit(doc);
        },

        connect: (connection, options) => {
          const { doc } = get();
          const result = options?.arrow ? checkArrow(doc, connection) : checkConnection(doc, connection);
          if (!result.ok) return result;
          const ends = { id: newId(), source: connection.source, target: connection.target };
          commit(
            ops.addEdge(
              doc,
              // FK handles are derived from the column ids, so they aren't stored
              result.kind === 'fk'
                ? { ...ends, kind: 'fk', data: result.data }
                : {
                    ...ends,
                    kind: result.kind,
                    // Link edges attach to the table itself, not to a column that may be deleted
                    // Element links store the element, not the side: the mapping picks the side facing the target
                    sourceHandle: columnIdOf(connection.sourceHandle)
                      ? 'r'
                      : storedSourceHandle(connection.sourceHandle),
                    targetHandle: columnIdOf(connection.targetHandle) ? 'l' : (connection.targetHandle ?? undefined),
                  },
            ),
          );
          return result;
        },

        editEdge: (edge) => commit(ops.replaceEdge(get().doc, CanvasEdge.parse(edge))),

        duplicate: (ids) => {
          const result = ops.duplicate(get().doc, ids);
          commit(result.doc);
          return result.ids;
        },

        sizeOf: (node) => get().resizeSizes[node.id] ?? node.size ?? get().measured[node.id] ?? DEFAULT_SIZE,

        arrange: (positions) => commit(layout.moveNodesAbsolute(get().doc, positions)),

        group: (ids) => {
          const result = layout.groupIntoFrame(get().doc, ids, get().sizeOf);
          commit(result.doc);
          return result.frameId;
        },

        ungroup: (ids) => commit(layout.ungroup(get().doc, ids)),

        applyImport: (doc) => commit(CanvasDoc.parse(doc)),

        addFlow: (input) => {
          const flow = Flow.parse({ ...input, id: newId(), steps: [] });
          commit(ops.addFlow(get().doc, flow));
          return flow.id;
        },

        saveFlow: (flow) => commit(ops.replaceFlow(get().doc, Flow.parse(flow))),

        removeFlow: (id) => commit(ops.removeFlow(get().doc, id)),

        upsertModel: (model) => commit(ops.upsertModel(get().doc, ApiModel.parse(model))),

        removeModel: (id) => commit(ops.removeModel(get().doc, id)),

        updateApiSettings: (settings) => commit({ ...get().doc, api: ApiSettings.parse(settings) }),

        setDatabaseDialect: (dialect) => commit(convertDocDialect(get().doc, dialect), { tag: false }),

        addFlowStep: (flowId, edgeId) => {
          const { doc } = get();
          const flow = doc.flows.find((f) => f.id === flowId);
          if (!flow) return { ok: false, reason: 'Unknown flow' };
          const result = canAppendStep(doc, flow.steps, edgeId);
          if (result.ok) commit(ops.replaceFlow(doc, { ...flow, steps: [...flow.steps, { edgeId }] }));
          return result;
        },

        addFeature: (input) => {
          const feature = Feature.parse({ ...input, id: newId() });
          commit(ops.addFeature(get().doc, feature));
          return feature.id;
        },

        saveFeature: (feature) => commit(ops.replaceFeature(get().doc, Feature.parse(feature))),

        removeFeature: (id) => {
          if (get().activeFeatureId === id) set({ activeFeatureId: null });
          commit(ops.removeFeature(get().doc, id));
        },

        setActiveFeature: (id) => set({ activeFeatureId: id && featureById(get().doc, id) ? id : null }),

        setFeatureItem: (featureId, ref, role) => {
          const { doc } = get();
          const original =
            ref.kind === 'node'
              ? doc.nodes.find((n) => n.id === ref.id)
              : ref.kind === 'model'
                ? doc.models.find((m) => m.id === ref.id)
                : undefined;
          if (ref.kind !== 'edge' && !original) return;
          commit(setFeatureItem(doc, featureId, ref, role, original), { tag: false });
        },

        removeFeatureItem: (featureId, ref) => commit(removeFeatureItem(get().doc, featureId, ref), { tag: false }),

        revertFeatureEntry: (featureId, ref, entry) => {
          const result = featureOps.revertFeatureEntry(get().doc, featureId, ref, entry);
          if (!result.ok) return result;
          commit(result.doc, { tag: false });
          return { ok: true };
        },

        shipFeature: (featureId) => {
          const result = shipFeature(get().doc, featureId);
          if (!result.ok) return result;
          // Shipped work isn't tagged any more
          if (get().activeFeatureId === featureId) set({ activeFeatureId: null });
          commit(result.doc, { tag: false });
          return { ok: true, warnings: result.warnings };
        },

        discardFeature: (featureId) => {
          const result = discardFeature(get().doc, featureId);
          if (!result.ok) return result;
          if (get().activeFeatureId === featureId) set({ activeFeatureId: null });
          commit(result.doc, { tag: false });
          return { ok: true, warnings: result.warnings };
        },

        revertFeatureItem: (featureId, ref) => {
          const result = featureOps.revertFeatureItem(get().doc, featureId, ref);
          if (!result.ok) return result;
          commit(result.doc, { tag: false });
          return { ok: true };
        },
      };
    },
    {
      partialize: (state) => ({ doc: state.doc }),
      // Only doc changes create history entries (not measurements or drag frames)
      equality: (past, current) => past.doc === current.doc,
      limit: 200,
    },
  ),
);

// Any doc change other than a load (edits, undo, redo) needs saving. A conflict stays a
// conflict until the user resolves it; edits made meanwhile are kept and saved afterwards.
useCanvasStore.subscribe((state, prev) => {
  if (loading || state.doc === prev.doc) return;
  if (state.saveState === 'saved' || state.saveState === 'saving' || state.saveState === 'error')
    useCanvasStore.setState({ saveState: 'dirty' });
});

export const undo = () => useCanvasStore.temporal.getState().undo();
export const redo = () => useCanvasStore.temporal.getState().redo();

export function useHistory() {
  const canUndo = useStore(useCanvasStore.temporal, (s) => s.pastStates.length > 0);
  const canRedo = useStore(useCanvasStore.temporal, (s) => s.futureStates.length > 0);
  return { canUndo, canRedo };
}
