import { FEATURE_ROLES, featureById, roleOf, type FeatureItemRef, type FeatureRole } from '@flowcanvas/shared';
import { Check } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useCanvasStore } from '../store/canvasStore';
import { useUiStore } from '../store/uiStore';
import { flowColorVar } from './flowColors';
import { itemTitle } from './featureView';

/** What each role means when picked from the menu */
const ROLE_ACTION: Record<FeatureRole, string> = {
  uses: 'Existing (used as is)',
  added: 'New (added by the feature)',
  changed: 'Changed by the feature',
  removed: 'Removed by the feature',
};

/**
 * Right-click menu on a node or edge: its role in the feature being worked on (or highlighted),
 * or, without one, "add to <feature>" for every feature.
 */
export function ContextMenu() {
  const menu = useUiStore((s) => s.contextMenu);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = () => useUiStore.getState().closeContextMenu();
    const onPointer = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    ref.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus();
    window.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('wheel', close, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('wheel', close);
    };
  }, [menu]);

  if (!menu) return null;
  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Feature actions"
      className="fixed z-50 min-w-56 rounded-lg border border-border bg-surface-raised py-1 text-sm shadow-lg"
      // Kept on screen near the right and bottom edges
      style={{ left: Math.min(menu.x, window.innerWidth - 240), top: Math.min(menu.y, window.innerHeight - 240) }}
    >
      <MenuBody itemRef={menu.ref} />
    </div>
  );
}

function MenuBody({ itemRef }: { itemRef: FeatureItemRef }) {
  const doc = useCanvasStore((s) => s.doc);
  const activeFeatureId = useCanvasStore((s) => s.activeFeatureId);
  const viewFeatureId = useUiStore((s) => s.viewFeatureId);
  const feature = featureById(doc, activeFeatureId ?? viewFeatureId ?? '');
  const done = () => useUiStore.getState().closeContextMenu();
  const title = <div className="truncate px-3 pt-1 pb-1.5 text-xs text-text-muted">{itemTitle(doc, itemRef)}</div>;

  if (!feature) {
    return (
      <>
        {title}
        {doc.features.length === 0 ? (
          <button
            type="button"
            role="menuitem"
            className="w-full px-3 py-1.5 text-left hover:bg-surface"
            onClick={() => {
              useUiStore.getState().setRightPanel('features');
              done();
            }}
          >
            No features yet: open the Features tab
          </button>
        ) : (
          doc.features.map((f) => (
            <button
              key={f.id}
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-surface"
              onClick={() => {
                useCanvasStore.getState().setFeatureItem(f.id, itemRef, roleOf(f, itemRef) ?? 'uses');
                done();
              }}
            >
              <span className="size-2 shrink-0 rounded-full" style={{ background: flowColorVar(f.color) }} />
              Use in {f.name}
              {roleOf(f, itemRef) && <Check aria-label="Already in it" className="ml-auto size-3.5" />}
            </button>
          ))
        )}
      </>
    );
  }

  const current = roleOf(feature, itemRef);
  return (
    <>
      {title}
      <div className="flex items-center gap-2 px-3 pb-1 text-xs font-medium">
        <span className="size-2 rounded-full" style={{ background: flowColorVar(feature.color) }} />
        {feature.name}
      </div>
      {FEATURE_ROLES.map((role) => (
        <button
          key={role}
          type="button"
          role="menuitemradio"
          aria-checked={current === role}
          className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-surface"
          onClick={() => {
            useCanvasStore.getState().setFeatureItem(feature.id, itemRef, role);
            done();
          }}
        >
          <span className="flex w-3.5 justify-center">{current === role && <Check className="size-3.5" />}</span>
          {ROLE_ACTION[role]}
        </button>
      ))}
      {current && (
        <button
          type="button"
          role="menuitem"
          className="w-full border-t border-border px-3 py-1.5 pl-8.5 text-left text-text-muted hover:bg-surface hover:text-text"
          onClick={() => {
            useCanvasStore.getState().removeFeatureItem(feature.id, itemRef);
            done();
          }}
        >
          Take out of the feature
        </button>
      )}
    </>
  );
}
