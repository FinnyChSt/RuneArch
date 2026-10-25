import type { ProjectMeta } from '@flowcanvas/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { createProject, deleteProject, listProjects } from '../api/client';

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** Minimal project list: create, open, delete */
export function ProjectsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const projects = useQuery({ queryKey: ['projects'], queryFn: listProjects });

  const create = useMutation({
    mutationFn: createProject,
    onSuccess: (project) => {
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      void navigate(`/p/${project.id}`);
    },
  });

  const remove = useMutation({
    mutationFn: deleteProject,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim()) create.mutate(name.trim());
  };

  const onDelete = (project: ProjectMeta) => {
    if (window.confirm(`Delete "${project.name}"? This cannot be undone.`)) remove.mutate(project.id);
  };

  return (
    <div className="min-h-full bg-canvas px-4 py-12">
      <div className="mx-auto max-w-2xl">
        <h1 className="mb-1 flex items-center gap-2 text-xl font-semibold">
          <img src="/icon-64.png" alt="" className="size-7" />
          <span className="text-accent">RuneArch</span> projects
        </h1>
        <p className="mb-8 text-sm text-text-muted">Design screens, endpoints, tables and the flows between them.</p>

        <form onSubmit={onSubmit} className="mb-6 flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="New project name"
            aria-label="New project name"
            maxLength={120}
            className="min-w-0 flex-1 rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none placeholder:text-text-muted focus:border-accent"
          />
          <button
            type="submit"
            disabled={!name.trim() || create.isPending}
            className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-2 text-sm font-medium text-canvas disabled:opacity-50"
          >
            <Plus className="size-4" /> Create
          </button>
        </form>
        {create.isError && <p className="mb-4 text-sm text-danger">Could not create the project.</p>}

        {projects.isPending && <p className="text-sm text-text-muted">Loading…</p>}
        {projects.isError && <p className="text-sm text-danger">Could not load projects. Is the API running?</p>}
        {projects.data?.length === 0 && (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-text-muted">
            No projects yet. Create your first one above.
          </p>
        )}

        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
          {projects.data?.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-raised">
              <Link to={`/p/${p.id}`} className="min-w-0 flex-1">
                <div className="truncate font-medium">{p.name}</div>
                <div className="text-xs text-text-muted">Updated {dateFormat.format(new Date(p.updatedAt))}</div>
              </Link>
              {p.role === 'owner' && (
                <button
                  type="button"
                  title="Delete project"
                  aria-label={`Delete ${p.name}`}
                  onClick={() => onDelete(p)}
                  className="rounded-md p-1.5 text-text-muted hover:bg-surface hover:text-danger"
                >
                  <Trash2 className="size-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
