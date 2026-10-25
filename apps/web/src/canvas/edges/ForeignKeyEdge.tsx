import { BaseEdge, getSmoothStepPath, type EdgeProps } from '@xyflow/react';
import type { FlowEdge } from '../mapping';
import { edgeStroke, StepBadge } from './flowStyle';

/*
 * Crow's-foot notation. Markers are drawn pointing along the path's end; with
 * orient="auto-start-reverse" the same marker flips to point into the source node.
 */
const MARKER_IDS = {
  many: 'fc-fk-many',
  one: 'fc-fk-one',
  manySelected: 'fc-fk-many-selected',
  oneSelected: 'fc-fk-one-selected',
};

/** SVG marker definitions, rendered once inside the canvas */
export function ForeignKeyMarkers() {
  const marker = (id: string, color: string, many: boolean) => (
    <marker
      id={id}
      viewBox="0 0 16 16"
      refX="16"
      refY="8"
      markerWidth="16"
      markerHeight="16"
      markerUnits="userSpaceOnUse"
      orient="auto-start-reverse"
    >
      <g style={{ stroke: color, strokeWidth: 1.5, fill: 'none', strokeLinecap: 'round' }}>
        {many ? <path d="M4 8 L16 2 M4 8 L16 8 M4 8 L16 14" /> : <path d="M10 3 L10 13" />}
      </g>
    </marker>
  );
  return (
    <svg aria-hidden className="absolute size-0">
      <defs>
        {marker(MARKER_IDS.many, 'var(--edge)', true)}
        {marker(MARKER_IDS.one, 'var(--edge)', false)}
        {marker(MARKER_IDS.manySelected, 'var(--accent)', true)}
        {marker(MARKER_IDS.oneSelected, 'var(--accent)', false)}
      </defs>
    </svg>
  );
}

/** Column-to-column FK: "many" end on the referencing column, "one" end on the referenced column */
export function ForeignKeyEdge({ data, selected, ...props }: EdgeProps<FlowEdge>) {
  const [path, labelX, labelY] = getSmoothStepPath({ ...props, borderRadius: 8, offset: 16 });
  const edge = data?.edge;
  const oneToOne = edge?.kind === 'fk' && edge.data.cardinality === '1:1';
  const suffix = selected ? 'Selected' : '';
  const start = MARKER_IDS[`${oneToOne ? 'one' : 'many'}${suffix}` as keyof typeof MARKER_IDS];
  const end = MARKER_IDS[`one${suffix}` as keyof typeof MARKER_IDS];

  return (
    <>
      <BaseEdge
        path={path}
        markerStart={`url(#${start})`}
        markerEnd={`url(#${end})`}
        style={edgeStroke(data?.flow, selected)}
        className={data?.flow?.current ? 'fc-edge-current' : undefined}
      />
      <StepBadge flow={data?.flow} x={labelX} y={labelY} />
    </>
  );
}
