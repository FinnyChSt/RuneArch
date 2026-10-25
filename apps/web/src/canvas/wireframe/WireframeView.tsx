import { DEVICES, WIRE_ROW_PX, wireframeRows, type Wireframe } from '@flowcanvas/shared';
import { memo } from 'react';
import { WireElementView } from './elements';
import { cellStyle, gridOf } from './grid';

export { cellStyle, gridOf };

/** Blank rows below the lowest element, so the page doesn't end at its last pixel */
const BOTTOM_ROWS = 2;
type Props = {
  wireframe: Wireframe;
  /** Rendered width in px; the design is scaled to fit */
  width: number;
  /** Clip taller pages at this height (px) and fade the cut */
  maxHeight?: number;
  /** Text as grey bars (for small sizes) */
  skeleton?: boolean;
  className?: string;
};

/** Pure render of a wireframe: its device width is scaled to `width`, elements sit on the grid */
export const WireframeView = memo(function WireframeView({ wireframe, width, maxHeight, skeleton = false, className = '' }: Props) {
  const { designWidth, column } = gridOf(wireframe.device);
  const scale = width / designWidth;
  const designHeight = (wireframeRows(wireframe) + BOTTOM_ROWS) * WIRE_ROW_PX;
  const height = designHeight * scale;
  const clipped = maxHeight !== undefined && height > maxHeight;

  return (
    <div
      role="img"
      aria-label={`${DEVICES[wireframe.device].label} wireframe`}
      className={`relative overflow-hidden rounded-md bg-wire-paper ${className}`}
      style={{ width, height: clipped ? maxHeight : height }}
    >
      <div
        className="absolute top-0 left-0 origin-top-left text-sm text-wire-ink"
        style={{ width: designWidth, height: designHeight, transform: `scale(${scale})` }}
      >
        {wireframe.elements.map((el) => (
          <div key={el.id} className="absolute" style={cellStyle(el.rect, column)}>
            <WireElementView el={el} column={column} skeleton={skeleton} />
          </div>
        ))}
      </div>
      {clipped && (
        <div className="absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-wire-paper to-transparent" />
      )}
    </div>
  );
});
