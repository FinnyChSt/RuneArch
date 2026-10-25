import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Braces, ChevronLeft, Database, Download, FileCode2, MonitorSmartphone, PanelRight, Redo2, Undo2, Upload, type LucideIcon } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { renameProject } from '../api/client';
import { redo, undo, useCanvasStore, useHistory, type SaveState } from '../store/canvasStore';
import { useUiStore } from '../store/uiStore';

const SAVE_LABEL: Record<SaveState, string> = {
  saved: 'Saved',
  dirty: 'Unsaved changes',
  saving: 'Saving…',
  conflict: 'Not saved: conflict',
  error: 'Not saved',
};

type Props = { projectId: string; projectName?: string };

export function TopBar({ projectId, projectName }: Props) {
  const { canUndo, canRedo } = useHistory();
  const saveState = useCanvasStore((s) => s.saveState);
  const rightPanel = useUiStore((s) => s.rightPanel);
  const setRightPanel = useUiStore((s) => s.setRightPanel);

  return (
    <header className="flex h-11 shrink-0 items-center gap-3 border-b border-border bg-surface px-3 text-sm">
      <Link to="/" title="All projects" className="flex items-center gap-1 font-semibold text-accent">
        <ChevronLeft className="size-4" />
        <img src="/icon-64.png" alt="" className="size-5" />
        RuneArch
      </Link>
      <span className="text-border">/</span>
      <ProjectName key={projectName} projectId={projectId} name={projectName} />
      <span
        role="status"
        className={`text-xs ${saveState === 'conflict' || saveState === 'error' ? 'text-danger' : 'text-text-muted'}`}
      >
        {SAVE_LABEL[saveState]}
      </span>

      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          onClick={() => useUiStore.getState().openDialog({ kind: 'spec' })}
          className="mr-2 flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-surface-raised"
        >
          <FileCode2 className="size-3.5 text-accent" /> API Spec
        </button>
        <button
          type="button"
          onClick={() => useUiStore.getState().openDialog({ kind: 'schema' })}
          className="mr-2 flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-surface-raised"
        >
          <Database className="size-3.5 text-node-db" /> DB Schema
        </button>
        <button
          type="button"
          onClick={() => useUiStore.getState().openDialog({ kind: 'code' })}
          className="mr-2 flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-surface-raised"
        >
          <Braces className="size-3.5 text-node-be" /> Code
        </button>
        <button
          type="button"
          onClick={() => useUiStore.getState().openDialog({ kind: 'screens' })}
          className="mr-2 flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-surface-raised"
        >
          <MonitorSmartphone className="size-3.5 text-node-fe" /> Screens
        </button>
        <button
          type="button"
          onClick={() => useUiStore.getState().openDialog({ kind: 'import' })}
          className="mr-2 flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-surface-raised"
        >
          <Upload className="size-3.5 text-text-muted" /> Import
        </button>
        <button
          type="button"
          onClick={() => useUiStore.getState().openDialog({ kind: 'export' })}
          className="mr-2 flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-surface-raised"
        >
          <Download className="size-3.5 text-text-muted" /> Export
        </button>
        <IconButton icon={Undo2} label="Undo (Ctrl+Z)" disabled={!canUndo} onClick={undo} />
        <IconButton icon={Redo2} label="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={redo} />
        <div className="mx-1 h-5 w-px bg-border" />
        <IconButton
          icon={PanelRight}
          label="Toggle side panel"
          pressed={rightPanel !== null}
          onClick={() => setRightPanel(rightPanel ? null : 'flows')}
        />
      </div>
    </header>
  );
}

/** Click to rename; Enter or blur saves, Escape cancels */
function ProjectName({ projectId, name }: { projectId: string; name?: string }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<string | null>(null);
  // Escape unmounts the input, which fires blur; don't treat that as "save"
  const cancelled = useRef(false);
  const rename = useMutation({
    mutationFn: (next: string) => renameProject(projectId, next),
    onSuccess: (project) => {
      queryClient.setQueryData(['project', projectId], project);
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
  });

  if (name === undefined) return <span className="text-text-muted">…</span>;

  if (draft === null) {
    return (
      <button
        type="button"
        title="Rename project"
        onClick={() => {
          cancelled.current = false;
          setDraft(name);
        }}
        className="max-w-64 truncate rounded px-1 font-medium hover:bg-surface-raised"
      >
        {rename.isPending ? rename.variables : name}
      </button>
    );
  }

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const next = draft.trim();
    if (next && next !== name) rename.mutate(next);
    setDraft(null);
  };

  return (
    <form onSubmit={submit}>
      <input
        autoFocus
        value={draft}
        maxLength={120}
        aria-label="Project name"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => (cancelled.current ? (cancelled.current = false) : submit())}
        onKeyDown={(e) => {
          if (e.key !== 'Escape') return;
          cancelled.current = true;
          setDraft(null);
        }}
        className="w-56 rounded border border-accent bg-canvas px-1 font-medium outline-none"
      />
    </form>
  );
}

type IconButtonProps = {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
};

function IconButton({ icon: Icon, label, onClick, disabled, pressed }: IconButtonProps) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-md p-1.5 transition-colors hover:bg-surface-raised hover:text-text disabled:pointer-events-none disabled:opacity-40 ${
        pressed ? 'text-accent' : 'text-text-muted'
      }`}
    >
      <Icon className="size-4" />
    </button>
  );
}
