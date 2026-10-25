import { WIRE_COLUMNS, WIRE_ROW_PX, type WireElement } from '@flowcanvas/shared';
import type { ReactNode } from 'react';
import { useCanvasStore } from '../../store/canvasStore';
import { boxWidth, cellStyle } from './grid';

/*
 * Low-fidelity renderers, one per element kind, drawn at design scale (WireframeView scales them).
 * In skeleton mode (canvas zoomed out) text becomes grey bars: it would be unreadable anyway.
 */

type Props = { el: WireElement; column: number; skeleton: boolean };

function Label({ text, skeleton, className = '' }: { text?: string; skeleton: boolean; className?: string }) {
  if (!text) return null;
  if (skeleton)
    return (
      <span
        className={`inline-block h-[0.6em] max-w-full shrink rounded-full bg-current opacity-60 ${className}`}
        style={{ width: `${Math.min(text.length, 40) * 0.55}em` }}
      />
    );
  return <span className={`min-w-0 truncate ${className}`}>{text}</span>;
}

const box = 'size-full rounded-md border-2 border-wire-line';

function Items({ items, skeleton, gap = 'gap-4' }: { items?: string[]; skeleton: boolean; gap?: string }) {
  return (
    <div className={`flex min-w-0 items-center ${gap}`}>
      {items?.map((item, i) => <Label key={i} text={item} skeleton={skeleton} />)}
    </div>
  );
}

function Rows({ items, skeleton, header }: { items: string[]; skeleton: boolean; header?: boolean }) {
  return (
    <div className="flex size-full flex-col overflow-hidden rounded-md border-2 border-wire-line">
      {items.map((item, i) => (
        <div
          key={i}
          className={`flex min-h-10 items-center gap-3 border-b-2 border-wire-line px-3 last:border-b-0 ${
            header && i === 0 ? 'bg-wire-fill font-semibold' : ''
          }`}
        >
          {!header && <span className="size-5 shrink-0 rounded-full bg-wire-fill" />}
          <Label text={item} skeleton={skeleton} />
        </div>
      ))}
    </div>
  );
}

const RENDER: Record<WireElement['kind'], (p: Props) => ReactNode> = {
  header: ({ el, skeleton }) => (
    <div className="flex size-full items-center justify-between gap-4 rounded-md bg-wire-fill px-4">
      <Label text={el.text} skeleton={skeleton} className="font-semibold text-wire-strong" />
      <Items items={el.items} skeleton={skeleton} />
    </div>
  ),
  nav: ({ el, column, skeleton }) =>
    el.rect.h * WIRE_ROW_PX > el.rect.w * column ? (
      <div className="flex size-full flex-col gap-4 rounded-md bg-wire-fill p-4">
        {el.items?.map((item, i) => <Label key={i} text={item} skeleton={skeleton} />)}
      </div>
    ) : (
      <div className="flex size-full items-center rounded-md border-2 border-wire-line px-4">
        <Items items={el.items} skeleton={skeleton} gap="gap-6" />
      </div>
    ),
  heading: ({ el, skeleton }) => (
    <div className="flex size-full items-center text-2xl font-semibold text-wire-strong">
      <Label text={el.text} skeleton={skeleton} />
    </div>
  ),
  text: ({ el, skeleton }) => (
    <p className="size-full overflow-hidden leading-snug">
      {skeleton ? <Label text={el.text} skeleton /> : el.text}
    </p>
  ),
  button: ({ el, skeleton }) => (
    <div
      className={`flex size-full items-center justify-center rounded-md px-3 font-medium ${
        el.variant === 'primary'
          ? 'bg-wire-strong text-wire-paper'
          : el.variant === 'ghost'
            ? 'text-wire-strong'
            : 'border-2 border-wire-strong text-wire-strong'
      }`}
    >
      <Label text={el.text} skeleton={skeleton} />
    </div>
  ),
  link: ({ el, skeleton }) => (
    <div className="flex size-full items-center text-wire-strong underline underline-offset-4">
      <Label text={el.text} skeleton={skeleton} />
    </div>
  ),
  input: ({ el, skeleton }) => (
    <div className={`${box} flex items-center px-3`}>
      <Label text={el.text} skeleton={skeleton} className="opacity-70" />
    </div>
  ),
  textarea: ({ el, skeleton }) => (
    <div className={`${box} p-3`}>
      <Label text={el.text} skeleton={skeleton} className="opacity-70" />
    </div>
  ),
  select: ({ el, skeleton }) => (
    <div className={`${box} flex items-center justify-between gap-2 px-3`}>
      <Label text={el.text ?? el.items?.[0]} skeleton={skeleton} className="opacity-70" />
      <span className="shrink-0 text-xs">▼</span>
    </div>
  ),
  checkbox: ({ el, skeleton }) => (
    <div className="flex size-full items-center gap-2">
      <span className="size-4 shrink-0 rounded-sm border-2 border-wire-line" />
      <Label text={el.text} skeleton={skeleton} />
    </div>
  ),
  image: () => (
    <svg className="size-full rounded-md border-2 border-wire-line" preserveAspectRatio="none" viewBox="0 0 100 100">
      <path d="M0 0 L100 100 M100 0 L0 100" className="stroke-wire-line" strokeWidth={1} vectorEffect="non-scaling-stroke" />
    </svg>
  ),
  list: ({ el, skeleton }) => <Rows items={el.items ?? []} skeleton={skeleton} />,
  table: ({ el, skeleton }) => (
    <div className="flex size-full flex-col overflow-hidden rounded-md border-2 border-wire-line">
      {[0, 1, 2, 3, 4].map((row) => (
        <div
          key={row}
          className={`flex min-h-10 border-b-2 border-wire-line last:border-b-0 ${row === 0 ? 'bg-wire-fill font-semibold' : ''}`}
        >
          {(el.items ?? []).map((col, i) => (
            <div key={i} className="flex min-w-0 flex-1 items-center px-3">
              {row === 0 ? (
                <Label text={col} skeleton={skeleton} />
              ) : (
                <span className="h-2 w-3/5 rounded-full bg-wire-fill" />
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  ),
  card: ({ el, skeleton }) => (
    <div className={`${box} flex flex-col gap-2 overflow-hidden p-3`}>
      <Label text={el.text} skeleton={skeleton} className="font-semibold text-wire-strong" />
      <span className="h-2 w-4/5 rounded-full bg-wire-fill" />
      <span className="h-2 w-3/5 rounded-full bg-wire-fill" />
    </div>
  ),
  tabs: ({ el, skeleton }) => (
    <div className="flex size-full items-end gap-1 border-b-2 border-wire-line">
      {el.items?.map((item, i) => (
        <div
          key={i}
          className={`flex min-w-0 items-center rounded-t-md px-4 py-2 ${i === 0 ? 'bg-wire-fill text-wire-strong' : ''}`}
        >
          <Label text={item} skeleton={skeleton} />
        </div>
      ))}
    </div>
  ),
  form: ({ el, skeleton }) => (
    <div className="size-full rounded-md border-2 border-dashed border-wire-line px-4 py-2">
      <Label text={el.text} skeleton={skeleton} className="text-xs uppercase tracking-wide" />
    </div>
  ),
  divider: () => (
    <div className="flex size-full items-center">
      <span className="h-0.5 w-full bg-wire-line" />
    </div>
  ),  instance: (p) => <Instance {...p} />,
};

/**
 * A placed component: its wireframe reflows to this box (12 columns across its width, rows
 * unchanged), so a card or nav bar keeps its text size wherever it's used.
 */
function Instance({ el, column, skeleton }: Props) {
  const component = useCanvasStore((s) => s.doc.nodes.find((n) => n.id === el.componentId));
  const wireframe = component?.type === 'component' ? component.data.wireframe : undefined;
  const inner = boxWidth(el.rect, column) / WIRE_COLUMNS;
  return (
    <div className="relative size-full overflow-hidden rounded-md outline-1 outline-wire-line outline-dashed">
      {wireframe?.elements.length ? (
        wireframe.elements.map((child) => (
          <div key={child.id} className="absolute" style={cellStyle(child.rect, inner)}>
            <WireElementView el={child} column={inner} skeleton={skeleton} />
          </div>
        ))
      ) : (
        <div className="flex size-full items-center justify-center">
          <Label text={component ? component.label || 'Component' : 'Missing component'} skeleton={skeleton} className="opacity-70" />
        </div>
      )}
    </div>
  );
}

export function WireElementView(props: Props) {
  return RENDER[props.el.kind](props);
}
