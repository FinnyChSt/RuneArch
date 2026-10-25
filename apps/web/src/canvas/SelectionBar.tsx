import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  Group,
  Network,
  Ungroup,
  type LucideIcon,
} from 'lucide-react';
import { useCanvasStore } from '../store/canvasStore';
import { useUiStore } from '../store/uiStore';
import type { AlignMode } from './arrange';
import { alignSelection, distributeSelection, groupSelection, layoutSelection, ungroupSelection } from './arrangeActions';

const ALIGN: { mode: AlignMode; icon: LucideIcon; label: string }[] = [
  { mode: 'left', icon: AlignStartVertical, label: 'Align left' },
  { mode: 'center', icon: AlignCenterVertical, label: 'Align centers horizontally' },
  { mode: 'right', icon: AlignEndVertical, label: 'Align right' },
  { mode: 'top', icon: AlignStartHorizontal, label: 'Align top' },
  { mode: 'middle', icon: AlignCenterHorizontal, label: 'Align centers vertically' },
  { mode: 'bottom', icon: AlignEndHorizontal, label: 'Align bottom' },
];

/** Floating bar over the canvas while several nodes (or a frame) are selected: arrange, group, lay out */
export function SelectionBar() {
  const selection = useUiStore((s) => s.selection);
  const nodes = useCanvasStore((s) => s.doc.nodes);
  const selected = nodes.filter((n) => selection.includes(n.id));
  const count = selected.filter((n) => !(n.parentId && selection.includes(n.parentId))).length;
  const hasFrame = selected.some((n) => n.type === 'frame');
  if (count < 2 && !hasFrame) return null;

  return (
    <div
      role="toolbar"
      aria-label="Arrange selection"
      className="absolute top-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-0.5 rounded-lg border border-border bg-surface p-1 shadow-lg shadow-black/20"
    >
      {count >= 2 && (
        <>
          {ALIGN.map(({ mode, icon, label }) => (
            <BarButton key={mode} icon={icon} label={label} onClick={() => alignSelection(mode)} />
          ))}
          <Divider />
          <BarButton
            icon={AlignHorizontalDistributeCenter}
            label="Distribute horizontally"
            disabled={count < 3}
            onClick={() => distributeSelection('horizontal')}
          />
          <BarButton
            icon={AlignVerticalDistributeCenter}
            label="Distribute vertically"
            disabled={count < 3}
            onClick={() => distributeSelection('vertical')}
          />
          <Divider />
          <BarButton icon={Network} label="Auto-layout (Shift+L)" onClick={() => void layoutSelection()} />
          <BarButton icon={Group} label="Group in a frame (Ctrl+G)" onClick={groupSelection} />
        </>
      )}
      {hasFrame && <BarButton icon={Ungroup} label="Ungroup (Ctrl+Shift+G)" onClick={ungroupSelection} />}
    </div>
  );
}

function BarButton({ icon: Icon, label, disabled, onClick }: { icon: LucideIcon; label: string; disabled?: boolean; onClick(): void }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="rounded-md p-1.5 text-text-muted hover:bg-surface-raised hover:text-text disabled:opacity-30"
    >
      <Icon className="size-4" />
    </button>
  );
}

const Divider = () => <div className="mx-1 h-5 w-px bg-border" />;
