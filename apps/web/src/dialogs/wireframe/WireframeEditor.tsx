import { WIRE_ROW_PX, wireframeRows, type ApiModel, type WireDevice, type WireElement, type WireKind, type Wireframe } from '@flowcanvas/shared';
import { ArrowUpRight } from 'lucide-react';
import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent, type PointerEvent } from 'react';
import { WireElementView } from '../../canvas/wireframe/elements';
import { cellStyle, gridOf } from '../../canvas/wireframe/WireframeView';
import type { LinkKind } from '../../canvas/connectRules';
import type { ElementLink } from '../../store/docOps';
import { newId } from '../../store/nodeFactory';
import { Inspector } from './Inspector';
import { COMPONENT_MIME, Palette, PALETTE_MIME } from './Palette';
import {
  addElement,
  addInstance,
  duplicateElement,
  moveRect,
  nudgeElement,
  PALETTE,
  removeElement,
  reorderElement,
  resizeRect,
  updateElement,
  type Handle,
} from './wireframeDraft';

/** A component that can be placed on a screen */
export type WireComponent = { id: string; name: string; wireframe?: Wireframe };

/** A node an element can link to */
export type LinkTarget = { id: string; title: string; group: 'screen' | 'endpoint'; kind: LinkKind };

type Props = {
  wireframe: Wireframe;
  /** Links from elements to other nodes (edges once saved) */
  links: readonly ElementLink[];
  targets: readonly LinkTarget[];
  /** Models a form, list or table can show */
  models: readonly ApiModel[];
  /** Components to place; undefined while editing a component (they don't nest) */
  components?: readonly WireComponent[];
  /** Elements can link to other nodes (screens only) */
  linkable: boolean;
  /** `key` merges consecutive changes (typing, nudging) into one undo step */
  onChange(next: Wireframe, key?: string): void;
  onLinksChange(next: ElementLink[]): void;
  onUndo(): void;
  onRedo(): void;
};

/** Frame scale per device, so desktop fits next to the palette and inspector */
const SCALE: Record<WireDevice, number> = { desktop: 0.75, tablet: 0.9, mobile: 1 };
/** Empty rows below the content, room to drop and drag into */
const SPARE_ROWS = 24;
const MIN_ROWS = 64;
/** Handle size on screen (px), whatever the scale */
const HANDLE_PX = 9;
const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const HANDLE_POS: Record<Handle, { left: string; top: string; cursor: string }> = {
  nw: { left: '0%', top: '0%', cursor: 'nwse-resize' },
  n: { left: '50%', top: '0%', cursor: 'ns-resize' },
  ne: { left: '100%', top: '0%', cursor: 'nesw-resize' },
  e: { left: '100%', top: '50%', cursor: 'ew-resize' },
  se: { left: '100%', top: '100%', cursor: 'nwse-resize' },
  s: { left: '50%', top: '100%', cursor: 'ns-resize' },
  sw: { left: '0%', top: '100%', cursor: 'nesw-resize' },
  w: { left: '0%', top: '50%', cursor: 'ew-resize' },
};

/** "Button: Place order", "Component: ProductCard" */
const elementLabel = (el: WireElement, components: readonly WireComponent[] | undefined) => {
  const text = el.kind === 'instance' ? components?.find((c) => c.id === el.componentId)?.name : el.text;
  return `${PALETTE[el.kind].label}${text ? `: ${text}` : ''}`;
};

const sameRect = (a: WireElement['rect'], b: WireElement['rect']) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

/**
 * Wireframe editor: palette | device frame on a snap grid | inspector. Drags preview locally and
 * commit once on release, so each move or resize is one undo step.
 */
export function WireframeEditor({ wireframe, links, targets, models, components, linkable, onChange, onLinksChange, onUndo, onRedo }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ id: string; rect: WireElement['rect'] } | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);

  const { designWidth, column } = gridOf(wireframe.device);
  const scale = SCALE[wireframe.device];
  const rows = Math.max(MIN_ROWS, wireframeRows(wireframe) + SPARE_ROWS);
  const selected = wireframe.elements.find((el) => el.id === selectedId);

  useEffect(() => {
    selectedRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [selectedId]);

  const select = (id: string | null) => {
    setSelectedId(id);
    frameRef.current?.focus({ preventScroll: true });
  };

  const add = (kind: WireKind, at?: { x: number; y: number }) => {
    const id = newId();
    onChange(addElement(wireframe, kind, id, at));
    select(id);
  };

  const place = (componentId: string, at?: { x: number; y: number }) => {
    const component = components?.find((c) => c.id === componentId);
    if (!component) return;
    const id = newId();
    onChange(addInstance(wireframe, component, id, at));
    select(id);
  };

  const duplicate = (id: string) => {
    const copy = newId();
    onChange(duplicateElement(wireframe, id, copy));
    select(copy);
  };

  const remove = (id: string) => {
    onChange(removeElement(wireframe, id));
    select(null);
  };

  /** Moves (no handle) or resizes an element with the pointer; snaps to cells and commits on release */
  const startDrag = (e: PointerEvent, el: WireElement, handle?: Handle) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    select(el.id);
    const start = { x: e.clientX, y: e.clientY };
    const rectAt = (ev: globalThis.PointerEvent) => {
      const dx = Math.round((ev.clientX - start.x) / scale / column);
      const dy = Math.round((ev.clientY - start.y) / scale / WIRE_ROW_PX);
      return handle ? resizeRect(el.rect, handle, dx, dy) : moveRect(el.rect, dx, dy);
    };
    const move = (ev: globalThis.PointerEvent) => setDrag({ id: el.id, rect: rectAt(ev) });
    const up = (ev: globalThis.PointerEvent) => {
      window.removeEventListener('pointermove', move);
      setDrag(null);
      const rect = rectAt(ev);
      if (!sameRect(rect, el.rect)) onChange(updateElement(wireframe, el.id, { rect }));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();
    if (mod && key === 'z') (e.shiftKey ? onRedo : onUndo)();
    else if (mod && key === 'y') onRedo();
    else if (mod && key === 'd' && selected) duplicate(selected.id);
    else if ((key === 'delete' || key === 'backspace') && selected) remove(selected.id);
    else if (key.startsWith('arrow') && selected) {
      const step = e.shiftKey ? 5 : 1;
      const [dx, dy] = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -step], arrowdown: [0, step] }[key] ?? [0, 0];
      onChange(nudgeElement(wireframe, selected.id, dx!, dy!), `${selected.id}:nudge`);
    } else return;
    e.preventDefault();
  };

  const onDrop = (e: DragEvent) => {
    const kind = e.dataTransfer.getData(PALETTE_MIME) as WireKind;
    const componentId = e.dataTransfer.getData(COMPONENT_MIME);
    if (!frameRef.current || !((kind && kind in PALETTE) || componentId)) return;
    e.preventDefault();
    const box = frameRef.current.getBoundingClientRect();
    const at = { x: (e.clientX - box.left) / scale / column, y: (e.clientY - box.top) / scale / WIRE_ROW_PX };
    if (componentId) place(componentId, at);
    else add(kind, at);
  };

  return (
    // Fixed height (the dialog's 88vh less its header, tabs, toolbar and footer): only the panes scroll
    <div className="grid h-[calc(88vh-290px)] min-h-72 grid-cols-[136px_minmax(0,1fr)_224px] gap-4 [scrollbar-color:var(--border)_transparent]">
      <Palette onAdd={(kind) => add(kind)} components={components} onAddComponent={(id) => place(id)} />

      <div className="min-h-0 overflow-auto rounded-lg border border-border bg-surface p-4">
        <div
          ref={frameRef}
          tabIndex={0}
          role="application"
          aria-label="Wireframe"
          aria-roledescription="wireframe editor"
          onKeyDown={onKeyDown}
          onPointerDown={(e) => (e.target === e.currentTarget || e.target === e.currentTarget.firstChild) && select(null)}
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes(PALETTE_MIME) && !e.dataTransfer.types.includes(COMPONENT_MIME)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
          }}
          onDrop={onDrop}
          className="relative mx-auto overflow-hidden rounded-md bg-wire-paper outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          style={{ width: designWidth * scale, height: rows * WIRE_ROW_PX * scale }}
        >
          <div
            className="absolute top-0 left-0 origin-top-left text-sm text-wire-ink"
            style={{
              width: designWidth,
              height: rows * WIRE_ROW_PX,
              transform: `scale(${scale})`,
              backgroundImage:
                'linear-gradient(to right, color-mix(in srgb, var(--wire-line) 30%, transparent) 1px, transparent 1px),' +
                'linear-gradient(to bottom, color-mix(in srgb, var(--wire-line) 12%, transparent) 1px, transparent 1px)',
              backgroundSize: `${column}px ${WIRE_ROW_PX}px`,
            }}
          >
            {wireframe.elements.map((el) => {
              const isSelected = el.id === selectedId;
              const shown = drag?.id === el.id ? { ...el, rect: drag.rect } : el;
              return (
                <div
                  key={el.id}
                  ref={isSelected ? selectedRef : undefined}
                  role="button"
                  aria-label={elementLabel(el, components)}
                  aria-pressed={isSelected}
                  onPointerDown={(e) => startDrag(e, el)}
                  onDoubleClick={() => firstFieldRef.current?.focus()}
                  className={`absolute cursor-move rounded-md ${
                    isSelected ? 'outline-2 outline-offset-2 outline-accent' : 'hover:outline hover:outline-accent/50'
                  }`}
                  style={cellStyle(shown.rect, column)}
                >
                  <div className="pointer-events-none size-full">
                    <WireElementView el={shown} column={column} skeleton={false} />
                  </div>
                  {links.some((l) => l.elementId === el.id) && (
                    <span
                      title="Links to another node"
                      className="absolute -top-2.5 -right-2.5 flex size-5 items-center justify-center rounded-full bg-node-fe text-canvas"
                    >
                      <ArrowUpRight aria-label="Has links" className="size-3.5" />
                    </span>
                  )}
                  {isSelected &&
                    HANDLES.map((h) => (
                      <span
                        key={h}
                        aria-hidden
                        onPointerDown={(e) => startDrag(e, el, h)}
                        className="absolute rounded-sm border border-accent bg-surface-raised"
                        style={{
                          ...HANDLE_POS[h],
                          width: HANDLE_PX / scale,
                          height: HANDLE_PX / scale,
                          transform: 'translate(-50%, -50%)',
                        }}
                      />
                    ))}
                </div>
              );
            })}
          </div>
          {wireframe.elements.length === 0 && (
            <p className="pointer-events-none absolute inset-x-0 top-1/3 text-center text-xs text-text-muted">
              Drag components here, or click one in the list
            </p>
          )}
        </div>
      </div>

      <Inspector
        key={selected?.id}
        element={selected}
        links={selected ? links.filter((l) => l.elementId === selected.id) : []}
        targets={targets}
        models={models}
        components={components}
        linkable={linkable}
        onAddLink={(targetId) =>
          selected && onLinksChange([...links, { id: newId(), elementId: selected.id, targetId }])
        }
        onRemoveLink={(id) => onLinksChange(links.filter((l) => l.id !== id))}
        firstFieldRef={firstFieldRef}
        onPatch={(patch, key) => selected && onChange(updateElement(wireframe, selected.id, patch), key)}
        onDuplicate={() => selected && duplicate(selected.id)}
        onReorder={(to) => selected && onChange(reorderElement(wireframe, selected.id, to))}
        onRemove={() => selected && remove(selected.id)}
      />
    </div>
  );
}
