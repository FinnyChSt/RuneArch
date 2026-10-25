import {
  Circle,
  Cog,
  Database,
  Frame,
  Hand,
  Monitor,
  MousePointer2,
  MoveUpRight,
  Pencil,
  Plug,
  Puzzle,
  Square,
  StickyNote,
  Type,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { useUiStore, type Tool } from '../store/uiStore';

/** `group` starts a new section (drawn with a divider): navigate, nodes, sketch */
const TOOLS: { tool: Tool; icon: LucideIcon; label: string; shortcut?: string; group?: true }[] = [
  { tool: 'select', icon: MousePointer2, label: 'Select', shortcut: 'V' },
  { tool: 'pan', icon: Hand, label: 'Pan', shortcut: 'H' },
  { tool: 'screen', icon: Monitor, label: 'Screen', shortcut: 'S', group: true },
  { tool: 'component', icon: Puzzle, label: 'Component', shortcut: 'C' },
  { tool: 'endpoint', icon: Plug, label: 'Endpoint', shortcut: 'E' },
  { tool: 'service', icon: Cog, label: 'Service' },
  { tool: 'job', icon: Zap, label: 'Job / event', shortcut: 'J' },
  { tool: 'table', icon: Database, label: 'Table', shortcut: 'T' },
  { tool: 'frame', icon: Frame, label: 'Frame / swimlane', shortcut: 'F', group: true },
  { tool: 'rect', icon: Square, label: 'Rectangle', shortcut: 'R' },
  { tool: 'ellipse', icon: Circle, label: 'Ellipse', shortcut: 'O' },
  { tool: 'arrow', icon: MoveUpRight, label: 'Arrow: drag between any two nodes', shortcut: 'A' },
  { tool: 'text', icon: Type, label: 'Text', shortcut: 'X' },
  { tool: 'sticky', icon: StickyNote, label: 'Sticky note', shortcut: 'N' },
  { tool: 'pen', icon: Pencil, label: 'Pen', shortcut: 'P' },
];

export function Toolbar() {
  const current = useUiStore((s) => s.tool);
  const setTool = useUiStore((s) => s.setTool);

  return (
    <nav
      aria-label="Tools"
      className="absolute top-1/2 left-3 z-10 flex -translate-y-1/2 flex-col gap-1 rounded-lg border border-border bg-surface p-1"
    >
      {TOOLS.map(({ tool, icon: Icon, label, shortcut, group }) => (
        <div key={tool} className="contents">
          {group && <div className="mx-1.5 my-0.5 h-px bg-border" />}
          <button
            type="button"
            title={shortcut ? `${label} (${shortcut})` : label}
            aria-label={label}
            aria-pressed={current === tool}
            onClick={() => setTool(tool)}
            className={`rounded-md p-2 transition-colors ${
              current === tool ? 'bg-accent/20 text-accent' : 'text-text-muted hover:bg-surface-raised hover:text-text'
            }`}
          >
            <Icon className="size-4" />
          </button>
        </div>
      ))}
    </nav>
  );
}
