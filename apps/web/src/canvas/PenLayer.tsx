import { useReactFlow, useViewport } from '@xyflow/react';
import { useRef, useState, type PointerEvent } from 'react';
import { useCanvasStore } from '../store/canvasStore';
import { strokePath } from './nodes/SketchNode';

type Point = [number, number, number];

/**
 * Pen tool: captures pointer strokes over the canvas, previews them in screen space and adds each
 * finished stroke as a sketch node (one undo step). The pen stays active for the next stroke.
 */
export function PenLayer() {
  const { screenToFlowPosition } = useReactFlow();
  const { zoom } = useViewport();
  const ref = useRef<HTMLDivElement>(null);
  const [screenPoints, setScreenPoints] = useState<Point[] | null>(null);
  const flowPoints = useRef<Point[]>([]);

  const add = (e: PointerEvent) => {
    const box = ref.current!.getBoundingClientRect();
    const pressure = e.pointerType === 'pen' ? e.pressure : 0.5;
    const p = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    flowPoints.current.push([p.x, p.y, pressure]);
    setScreenPoints((pts) => [...(pts ?? []), [e.clientX - box.left, e.clientY - box.top, pressure]]);
  };

  return (
    <div
      ref={ref}
      aria-label="Drawing area"
      className="absolute inset-0 z-10 cursor-crosshair touch-none"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        flowPoints.current = [];
        setScreenPoints([]);
        add(e);
      }}
      onPointerMove={(e) => screenPoints && add(e)}
      onPointerUp={() => {
        const points = flowPoints.current;
        if (points.length >= 2) useCanvasStore.getState().addStroke(points);
        flowPoints.current = [];
        setScreenPoints(null);
      }}
    >
      {screenPoints && screenPoints.length > 1 && (
        <svg className="pointer-events-none absolute inset-0 size-full">
          <path
            d={strokePath(
              screenPoints.map(([x, y, p]) => [x / zoom, y / zoom, p]),
              false,
            )}
            transform={`scale(${zoom})`}
            className="fill-node-sketch"
          />
        </svg>
      )}
    </div>
  );
}

