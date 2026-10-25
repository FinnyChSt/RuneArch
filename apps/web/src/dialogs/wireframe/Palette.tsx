import { WireKind } from '@flowcanvas/shared';
import {
  AlignLeft,
  AppWindow,
  ChevronsUpDown,
  Heading,
  Image,
  Link,
  List,
  Menu,
  Minus,
  Puzzle,
  PanelTop,
  RectangleHorizontal,
  Square,
  SquareCheck,
  SquareDashed,
  Table,
  TextCursorInput,
  Type,
  type LucideIcon,
} from 'lucide-react';
import { PALETTE } from './wireframeDraft';

/** dataTransfer types for dragging a palette entry (an element kind, or a component id) onto the frame */
export const PALETTE_MIME = 'application/x-flowcanvas-wire-kind';
export const COMPONENT_MIME = 'application/x-flowcanvas-wire-component';

/** A component that can be placed (listed in the palette) */
export type PaletteComponent = { id: string; name: string };

const ICON: Record<WireKind, LucideIcon> = {
  header: PanelTop,
  nav: Menu,
  tabs: AppWindow,
  heading: Heading,
  text: Type,
  button: RectangleHorizontal,
  link: Link,
  input: TextCursorInput,
  textarea: AlignLeft,
  select: ChevronsUpDown,
  checkbox: SquareCheck,
  image: Image,
  card: Square,
  list: List,
  table: Table,
  form: SquareDashed,
  divider: Minus,
  instance: Puzzle,
};

const entryClass =
  'flex cursor-grab items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-text-muted hover:bg-surface hover:text-text active:cursor-grabbing';

type Props = {
  onAdd(kind: WireKind): void;
  /** Components to place; omitted when editing a component (they can't nest) */
  components?: readonly PaletteComponent[];
  onAddComponent?(id: string): void;
};

/** Element palette: click adds below everything, dragging drops it where the pointer is */
export function Palette({ onAdd, components, onAddComponent }: Props) {
  return (
    <div role="group" aria-label="Palette" className="grid min-h-0 content-start gap-0.5 overflow-y-auto">
      {components && (
        <>
          <h3 className="mb-1 px-2 text-[11px] font-semibold tracking-wide text-text-muted uppercase">Your components</h3>
          {components.length === 0 && (
            <p className="px-2 text-[11px] text-text-muted">Add a component node (C) to the canvas to reuse it here.</p>
          )}
          {components.map((c) => (
            <button
              key={c.id}
              type="button"
              draggable
              aria-label={`Place ${c.name}`}
              title="Click to place, or drag onto the screen"
              onClick={() => onAddComponent?.(c.id)}
              onDragStart={(e) => {
                e.dataTransfer.setData(COMPONENT_MIME, c.id);
                e.dataTransfer.effectAllowed = 'copy';
              }}
              className={entryClass}
            >
              <Puzzle className="size-3.5 shrink-0 text-node-fe" />
              <span className="truncate">{c.name}</span>
            </button>
          ))}
          <h3 className="mt-3 mb-1 px-2 text-[11px] font-semibold tracking-wide text-text-muted uppercase">Elements</h3>
        </>
      )}
      {WireKind.options
        .filter((kind) => kind !== 'instance')
        .map((kind) => {
          const Icon = ICON[kind];
          return (
            <button
              key={kind}
              type="button"
              draggable
              aria-label={`Add ${PALETTE[kind].label}`}
              title="Click to add, or drag onto the screen"
              onClick={() => onAdd(kind)}
              onDragStart={(e) => {
                e.dataTransfer.setData(PALETTE_MIME, kind);
                e.dataTransfer.effectAllowed = 'copy';
              }}
              className={entryClass}
            >
              <Icon className="size-3.5 shrink-0" />
              {PALETTE[kind].label}
            </button>
          );
        })}
    </div>
  );
}
