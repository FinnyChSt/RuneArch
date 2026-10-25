// @vitest-environment jsdom
import { emptyCanvas, type SnapshotMeta } from '@flowcanvas/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DialogHost } from '../dialogs/DialogHost';
import { useCanvasStore } from '../store/canvasStore';
import { useUiStore } from '../store/uiStore';
import { checkoutDoc } from '../test/fixtures';
import { HistoryPanel } from './HistoryPanel';
import { relativeTime } from './snapshotActions';

const store = () => useCanvasStore.getState();
const restoredDoc = { ...emptyCanvas(), nodes: [{ id: 'old', type: 'screen', label: 'Old home', position: { x: 0, y: 0 }, data: { state: [] } }] };

let snapshots: SnapshotMeta[];
let requests: string[];

/** A tiny fake of the snapshot API */
function fakeFetch(url: string, init?: RequestInit) {
  const method = init?.method ?? 'GET';
  requests.push(`${method} ${url}`);
  const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
  if (url === '/api/projects/p1/snapshots' && method === 'GET') return json(snapshots);
  if (url === '/api/projects/p1/snapshots' && method === 'POST') {
    const snap = { id: crypto.randomUUID(), label: JSON.parse(init!.body as string).label ?? null, createdAt: new Date().toISOString(), createdBy: 'dev' };
    snapshots = [snap, ...snapshots];
    return json(snap, 201);
  }
  const id = /snapshots\/([\w-]+)/.exec(url)?.[1];
  if (url.endsWith('/restore')) return json({ doc: restoredDoc, version: 9 });
  if (method === 'DELETE') {
    snapshots = snapshots.filter((s) => s.id !== id);
    return Promise.resolve(new Response(null, { status: 204 }));
  }
  const snap = snapshots.find((s) => s.id === id);
  return snap ? json({ ...snap, doc: restoredDoc }) : json({ message: 'Not found' }, 404);
}

beforeEach(() => {
  store().load(checkoutDoc(), 3, 'p1');
  useUiStore.setState({ dialog: null, selection: [], hint: null });
  snapshots = [{ id: '00000000-0000-4000-8000-000000000001', label: 'Before refactor', createdAt: new Date(Date.now() - 5 * 60_000).toISOString(), createdBy: 'dev' }];
  requests = [];
  vi.stubGlobal('fetch', vi.fn(fakeFetch));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <HistoryPanel />
      <DialogHost />
    </QueryClientProvider>,
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('history panel', () => {
  it('lists checkpoints and saves a new one', async () => {
    expect(await screen.findByText('Before refactor')).toBeTruthy();
    expect(screen.getByText('5 min ago · dev')).toBeTruthy();
    await userEvent.type(screen.getByLabelText('Checkpoint name'), 'Release 1');
    await userEvent.click(screen.getByRole('button', { name: 'Save checkpoint' }));
    expect(await screen.findByText('Release 1')).toBeTruthy();
    expect(useUiStore.getState().hint?.message).toBe('Checkpoint saved');
    expect((screen.getByLabelText('Checkpoint name') as HTMLInputElement).value).toBe('');
  });

  it('previews a checkpoint and restores it, loading the restored version', async () => {
    await userEvent.click(await screen.findByText('Before refactor'));
    const img = await screen.findByAltText('Checkpoint preview');
    expect(decodeURIComponent(img.getAttribute('src')!)).toContain('Old home');
    await userEvent.click(screen.getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(useUiStore.getState().dialog).toBeNull());
    expect(store().version).toBe(9);
    expect(store().doc.nodes.map((n) => n.label)).toEqual(['Old home']);
    expect(requests).toContain('POST /api/projects/p1/snapshots/00000000-0000-4000-8000-000000000001/restore');
    expect(useUiStore.getState().hint?.message).toMatch(/^Restored “Before refactor”/);
  });

  it('deletes a checkpoint after confirming', async () => {
    await userEvent.click(await screen.findByText('Before refactor'));
    await screen.findByAltText('Checkpoint preview');
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByText('Before refactor')).toBeNull());
    expect(snapshots).toEqual([]);
  });
});

describe('relativeTime', () => {
  it('reads like a person would say it', () => {
    const now = Date.parse('2026-09-30T12:00:00Z');
    expect(relativeTime('2026-09-30T11:59:40Z', now)).toBe('just now');
    expect(relativeTime('2026-09-30T11:15:00Z', now)).toBe('45 min ago');
    expect(relativeTime('2026-09-30T07:00:00Z', now)).toBe('5 h ago');
    expect(relativeTime('2026-09-29T08:00:00Z', now)).toBe('yesterday');
  });
});
