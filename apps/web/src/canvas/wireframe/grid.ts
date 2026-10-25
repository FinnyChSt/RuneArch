import { DEVICES, WIRE_COLUMNS, WIRE_ROW_PX, type WireDevice, type WireElement } from '@flowcanvas/shared';
import type { CSSProperties } from 'react';

/** Grid gap inside each cell (design px), so neighbouring elements don't touch */
const GUTTER = 3;

/** Design width and column width (px) of a device frame */
export function gridOf(device: WireDevice) {
  const designWidth = DEVICES[device].width;
  return { designWidth, column: designWidth / WIRE_COLUMNS };
}

/** Where an element's rect lands at design scale: its cells, less the gutter */
export function cellStyle(rect: WireElement['rect'], column: number): CSSProperties {
  return {
    left: rect.x * column + GUTTER,
    top: rect.y * WIRE_ROW_PX + GUTTER,
    width: rect.w * column - 2 * GUTTER,
    height: rect.h * WIRE_ROW_PX - 2 * GUTTER,
  };
}

/** Inner width (design px) of an element box: its columns less the gutters */
export const boxWidth = (rect: WireElement['rect'], column: number) => rect.w * column - 2 * GUTTER;
