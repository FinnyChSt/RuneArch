import { Handle, Position, useUpdateNodeInternals, type NodeProps } from '@xyflow/react';
import { KeyRound, Link2 } from 'lucide-react';
import { Fragment, useEffect, useRef } from 'react';
import { columnHandleId, type Side } from '../handles';
import type { FlowNode } from '../mapping';
import { NodeShell } from './NodeShell';

const SIDES: [Side, Position][] = [
  ['l', Position.Left],
  ['r', Position.Right],
];

/** dbdiagram-style table. Each column row has its own handles for foreign keys. */
export function TableNode({ id, data: { node, fkColumnIds = [], columnMarks }, selected }: NodeProps<FlowNode<'table'>>) {
  const { schema, columns } = node.data;

  // Handle positions are measured once; reordering rows without a size change needs a re-measure.
  // Not on mount: an early update makes React Flow run its initial fitView with this node alone.
  const updateNodeInternals = useUpdateNodeInternals();
  const order = columns.map((c) => c.id).join();
  const measuredOrder = useRef(order);
  useEffect(() => {
    if (measuredOrder.current === order) return;
    measuredOrder.current = order;
    updateNodeInternals(id);
  }, [id, order, updateNodeInternals]);

  return (
    // Table-level side handles sit on the header, clear of the column handles
    <NodeShell group="db" selected={selected} className="min-w-52" sideHandleTop={18}>
      <div className="border-b border-border bg-surface-raised px-3 py-1.5 font-mono text-xs font-semibold">
        {schema !== 'public' && <span className="text-text-muted">{schema}.</span>}
        {node.label || 'untitled'}
      </div>
      <ul className="py-1">
        {columns.map((c) => (
          <li key={c.id} className="fc-col-row relative flex items-center gap-3 px-3 py-0.5 font-mono text-xs">
            <span className="flex w-3 shrink-0 justify-center">
              {c.primaryKey ? (
                <KeyRound aria-label="Primary key" className="size-3 text-node-db" />
              ) : (
                fkColumnIds.includes(c.id) && <Link2 aria-label="Foreign key" className="size-3 text-text-muted" />
              )}
            </span>
            <span className="truncate">
              {columnMarks?.marks[c.id] && <ColumnMark mark={columnMarks.marks[c.id]!} />}
              {c.name}
            </span>
            <span className="ml-auto text-text-muted">{c.type}</span>
            {SIDES.map(([side, position]) => (
              <Fragment key={side}>
                <Handle id={columnHandleId(c.id, side)} type="target" position={position} className="fc-col-handle" />
                <Handle id={columnHandleId(c.id, side)} type="source" position={position} className="fc-col-handle" />
              </Fragment>
            ))}
          </li>
        ))}
        {columnMarks?.dropped.map((c) => (
          <li key={c.id} className="flex items-center gap-3 px-3 py-0.5 font-mono text-xs text-danger">
            <span className="w-3 shrink-0" />
            <span className="truncate line-through">
              <span aria-label="Dropped by the feature" className="mr-1 no-underline">
                −
              </span>
              {c.name}
            </span>
            <span className="ml-auto line-through opacity-70">{c.type}</span>
          </li>
        ))}
        {columns.length === 0 && !columnMarks?.dropped.length && (
          <li className="px-3 py-0.5 text-xs text-text-muted">No columns</li>
        )}
      </ul>
    </NodeShell>
  );
}

/** `+` for a column the highlighted feature adds, `~` for one it changes */
function ColumnMark({ mark }: { mark: 'added' | 'changed' }) {
  return (
    <span
      aria-label={mark === 'added' ? 'Added by the feature' : 'Changed by the feature'}
      className="mr-1 font-semibold"
      style={{ color: 'var(--feature-color, var(--accent))' }}
    >
      {mark === 'added' ? '+' : '~'}
    </span>
  );
}
