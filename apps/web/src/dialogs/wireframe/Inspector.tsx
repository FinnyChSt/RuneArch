import { isInteractive, MODEL_KINDS, type ApiModel, type WireElement } from '@flowcanvas/shared';
import { ArrowRight, BringToFront, Copy, SendToBack, Trash2, X } from 'lucide-react';
import type { Ref } from 'react';
import { Button, controlClass, Field, IconAction } from '../../components/ui/form';
import type { ElementLink } from '../../store/docOps';
import type { LinkTarget, WireComponent } from './WireframeEditor';
import { clampRect, componentRows, EDITABLE, PALETTE } from './wireframeDraft';

type Props = {
  element: WireElement | undefined;
  /** Links starting at this element */
  links: readonly ElementLink[];
  targets: readonly LinkTarget[];
  /** Models a form, list or table can show */
  models: readonly ApiModel[];
  /** Components an instance can show; undefined while editing a component */
  components?: readonly WireComponent[];
  onAddLink(targetId: string): void;
  onRemoveLink(linkId: string): void;
  /** `key` merges consecutive edits of one field into a single undo step */
  onPatch(patch: Partial<Omit<WireElement, 'id'>>, key: string): void;
  onDuplicate(): void;
  onReorder(to: 'front' | 'back'): void;
  onRemove(): void;
  /** Whether elements can link to other nodes (screens only) */
  linkable: boolean;
  /** The first content field, focused on double-click in the frame */
  firstFieldRef: Ref<HTMLInputElement & HTMLTextAreaElement>;
};

const RECT_FIELDS = [
  ['x', 'X (column)'],
  ['y', 'Y (row)'],
  ['w', 'Width (columns)'],
  ['h', 'Height (rows)'],
] as const;

/** Properties of the selected element */
export function Inspector(props: Props) {
  const { element, models, components, onPatch, onDuplicate, onReorder, onRemove, firstFieldRef } = props;
  if (!element)
    return (
      <div className="grid content-start gap-2 text-xs text-text-muted">
        <p>Select an element to edit it.</p>
        <p>Drag to move, drag its handles to resize. Arrow keys nudge (Shift for bigger steps), ⌘D duplicates, Delete removes.</p>
        {props.linkable ? (
          <>
            <p>Buttons, links, forms and lists can call an endpoint or open a screen: pick one under “On click”, or drag from the element’s dot on the canvas.</p>
            <p>Reuse a component by placing it from “Your components”; it follows the component’s layout.</p>
          </>
        ) : (
          <p>This layout shows up wherever the component is placed, reflowed to the width it gets there.</p>
        )}
        <p>“From endpoint” adds a form for an endpoint’s request body, or a list or table for its response.</p>
      </div>
    );

  const editable = EDITABLE[element.kind];
  const key = (field: string) => `${element.id}:${field}`;
  const TextControl = element.kind === 'text' ? 'textarea' : 'input';

  return (
    <div className="grid min-h-0 content-start gap-3 overflow-y-auto">
      <div className="flex items-center gap-1">
        <h3 className="flex-1 text-xs font-semibold tracking-wide text-text-muted uppercase">{PALETTE[element.kind].label}</h3>
        <IconAction label="Duplicate" onClick={onDuplicate}>
          <Copy className="size-3.5" />
        </IconAction>
        <IconAction label="Bring to front" onClick={() => onReorder('front')}>
          <BringToFront className="size-3.5" />
        </IconAction>
        <IconAction label="Send to back" onClick={() => onReorder('back')}>
          <SendToBack className="size-3.5" />
        </IconAction>
        <IconAction label="Delete element" onClick={onRemove}>
          <Trash2 className="size-3.5" />
        </IconAction>
      </div>

      {editable.text && (
        <Field label={editable.text}>
          <TextControl
            ref={firstFieldRef}
            value={element.text ?? ''}
            rows={4}
            onChange={(e) => onPatch({ text: e.target.value }, key('text'))}
            className={controlClass}
            autoComplete="off"
          />
        </Field>
      )}
      {editable.items && (
        <Field label={editable.items} hint="One per line">
          <textarea
            ref={editable.text ? undefined : firstFieldRef}
            value={(element.items ?? []).join('\n')}
            rows={4}
            onChange={(e) => onPatch({ items: e.target.value.split('\n') }, key('items'))}
            className={controlClass}
          />
        </Field>
      )}
      {editable.variant && (
        <Field label="Style">
          <select
            value={element.variant ?? 'secondary'}
            onChange={(e) => onPatch({ variant: e.target.value as WireElement['variant'] }, key('variant'))}
            className={controlClass}
          >
            <option value="primary">Primary</option>
            <option value="secondary">Secondary</option>
            <option value="ghost">Ghost</option>
          </select>
        </Field>
      )}

      {element.kind === 'instance' && (
        <div className="grid gap-1.5">
          <Field label="Component" hint="Edit it by double-clicking the component on the canvas">
            <select
              value={element.componentId ?? ''}
              onChange={(e) => onPatch({ componentId: e.target.value }, key('componentId'))}
              className={controlClass}
            >
              {!components?.some((c) => c.id === element.componentId) && <option value={element.componentId}>Missing component</option>}
              {components?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Button
            className="justify-center text-xs"
            onClick={() => {
              const rows = componentRows(components?.find((c) => c.id === element.componentId)?.wireframe);
              onPatch({ rect: { ...element.rect, h: rows } }, key('fit'));
            }}
          >
            Fit height to component
          </Button>
        </div>
      )}

      {MODEL_KINDS.includes(element.kind) && (
        <Field label="Model" hint={element.kind === 'form' ? 'What the form submits' : 'What each row shows'}>
          <select
            value={element.modelRef ?? ''}
            onChange={(e) => onPatch({ modelRef: e.target.value || undefined }, key('modelRef'))}
            className={controlClass}
          >
            <option value="">None</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </Field>
      )}

      {isInteractive(element.kind) && props.linkable && <LinkList {...props} />}

      <div className="grid grid-cols-2 gap-2">
        {RECT_FIELDS.map(([field, label]) => (
          <Field key={field} label={label}>
            <input
              type="number"
              value={element.rect[field]}
              onChange={(e) => {
                const n = e.target.valueAsNumber;
                if (Number.isFinite(n)) onPatch({ rect: clampRect({ ...element.rect, [field]: n }) }, key('rect'));
              }}
              className={controlClass}
            />
          </Field>
        ))}
      </div>
    </div>
  );
}

/** "On click": where this element leads (screens) or what it calls (endpoints) */
function LinkList({ links, targets, onAddLink, onRemoveLink }: Props) {
  const linked = new Set(links.map((l) => l.targetId));
  const available = targets.filter((t) => !linked.has(t.id));
  const group = (g: LinkTarget['group']) => available.filter((t) => t.group === g);
  return (
    <div className="grid gap-1.5">
      <span className="text-xs font-medium text-text-muted">On click</span>
      {links.map((link) => {
        const target = targets.find((t) => t.id === link.targetId);
        return (
          <div key={link.id} className="flex items-center gap-1.5 rounded-md border border-border bg-surface py-1 pr-1 pl-2 text-xs">
            <ArrowRight className="size-3 shrink-0 text-node-fe" />
            <span className="min-w-0 flex-1 truncate font-mono">{target?.title ?? 'Missing node'}</span>
            <span className="text-text-muted">{target?.kind}</span>
            <IconAction label={`Remove link to ${target?.title ?? 'missing node'}`} onClick={() => onRemoveLink(link.id)}>
              <X className="size-3.5" />
            </IconAction>
          </div>
        );
      })}
      {available.length > 0 ? (
        <select
          aria-label="Add link"
          value=""
          onChange={(e) => e.target.value && onAddLink(e.target.value)}
          className={controlClass}
        >
          <option value="">Link to…</option>
          {(['endpoint', 'screen'] as const).map(
            (g) =>
              group(g).length > 0 && (
                <optgroup key={g} label={g === 'endpoint' ? 'Call an endpoint' : 'Open a screen'}>
                  {group(g).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                    </option>
                  ))}
                </optgroup>
              ),
          )}
        </select>
      ) : (
        links.length === 0 && <p className="text-xs text-text-muted">Add endpoints or other screens to the canvas to link to them.</p>
      )}
    </div>
  );
}
