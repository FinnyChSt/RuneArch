import type { NodeTypes } from '@xyflow/react';
import { ComponentNode } from './ComponentNode';
import { EndpointNode } from './EndpointNode';
import { FrameNode } from './FrameNode';
import { JobNode } from './JobNode';
import { ScreenNode } from './ScreenNode';
import { ServiceNode } from './ServiceNode';
import { SketchNode } from './SketchNode';
import { TableNode } from './TableNode';

/** Registered once at module level so React Flow never sees a new object */
export const nodeTypes = {
  screen: ScreenNode,
  component: ComponentNode,
  endpoint: EndpointNode,
  service: ServiceNode,
  job: JobNode,
  table: TableNode,
  frame: FrameNode,
  sketch: SketchNode,
} satisfies NodeTypes;
