// @vitest-environment jsdom
import { CanvasDoc, featureById } from '@flowcanvas/shared';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { undo, useCanvasStore } from '../store/canvasStore';
import { useUiStore } from '../store/uiStore';
import { shopDoc } from '../test/fixtures';
import { FeaturesPanel } from './FeaturesPanel';

const saveCheckpoint = vi.hoisted(() => vi.fn(async () => true));
vi.mock('../history/snapshotActions', () => ({ saveCheckpoint }));

const store = () => useCanvasStore.getState();
const ui = () => useUiStore.getState();

/** shopDoc where Orders (in progress) adds orders and POST /orders and removes GET /orders; Profiles also changes users */
function lifecycleDoc() {
  const doc = shopDoc();
  const users = doc.nodes.find((n) => n.id === 'users')!;
  const usersBase = users.type === 'table' ? { ...users, data: { ...users.data, columns: users.data.columns.slice(0, 1) } } : users;
  return CanvasDoc.parse({
    ...doc,
    features: [
      {
        id: 'f',
        name: 'Orders',
        status: 'in-progress',
        items: [
          { ref: { kind: 'node', id: 'orders' }, role: 'added' },
          { ref: { kind: 'node', id: 'post' }, role: 'added' },
          { ref: { kind: 'edge', id: 'fk' }, role: 'added' },
          { ref: { kind: 'edge', id: 'w' }, role: 'added' },
          { ref: { kind: 'node', id: 'get' }, role: 'removed' },
          { ref: { kind: 'node', id: 'users' }, role: 'changed' },
        ],
        baseline: { nodes: { users: usersBase } },
      },
      { id: 'p', name: 'Profiles', items: [{ ref: { kind: 'node', id: 'users' }, role: 'changed' }], baseline: { nodes: { users: usersBase } } },
    ],
  });
}

let confirm: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  store().load(lifecycleDoc(), 1, 'p1');
  store().setActiveFeature('f');
  useUiStore.setState({ viewFeatureId: 'f', activeFlowId: null, hint: null, dialog: null });
  saveCheckpoint.mockClear();
  confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
  render(<FeaturesPanel />);
});

afterEach(() => {
  cleanup();
  confirm.mockRestore();
});

describe('feature lifecycle', () => {
  it('warns about other features changing the same parts', () => {
    expect(screen.getByRole('region', { name: 'Warnings' }).textContent).toContain('Profiles also changes or removes users');
  });

  it('ships after a checkpoint: removed parts are deleted, the feature is shipped, in one undo step', async () => {
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Ship…' }));
    await waitFor(() => expect(featureById(store().doc, 'f')!.status).toBe('shipped'));
    expect(confirm.mock.calls[0]![0]).toContain('Ship "Orders"?');
    expect(saveCheckpoint).toHaveBeenCalledWith(expect.anything(), 'Before shipping “Orders”');
    expect(store().doc.nodes.map((n) => n.id)).not.toContain('get');
    expect(featureById(store().doc, 'f')!.baseline).toEqual({ nodes: {}, models: {} });
    expect(store().activeFeatureId).toBeNull();
    expect(ui().hint?.message).toBe('Shipped Orders');
    expect(screen.queryByRole('button', { name: 'Discard…' })).toBeNull();

    act(() => undo());
    expect(featureById(store().doc, 'f')!.status).toBe('in-progress');
    expect(store().doc.nodes.map((n) => n.id)).toContain('get');
  });

  it('asks again when no checkpoint can be saved, and stops on no', async () => {
    const user = userEvent.setup();
    saveCheckpoint.mockResolvedValueOnce(false);
    confirm.mockReturnValueOnce(true).mockReturnValueOnce(false);
    await user.click(screen.getByRole('button', { name: 'Ship…' }));
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(2));
    expect(confirm.mock.calls[1]![0]).toContain('No checkpoint could be saved');
    expect(featureById(store().doc, 'f')!.status).toBe('in-progress');
  });

  it('discards: additions deleted, changes restored, feature gone, in one undo step', async () => {
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Discard…' }));
    expect(store().doc.nodes.map((n) => n.id)).toEqual(['users', 'get']);
    const users = store().doc.nodes.find((n) => n.id === 'users');
    expect(users?.type === 'table' && users.data.columns.map((c) => c.name)).toEqual(['id']);
    expect(store().doc.features.map((f) => f.id)).toEqual(['p']);
    expect(ui().viewFeatureId).toBeNull();
    expect(ui().hint?.message).toBe('Discarded Orders');
    expect(() => CanvasDoc.parse(store().doc)).not.toThrow();

    act(() => undo());
    expect(store().doc.features.map((f) => f.id)).toEqual(['f', 'p']);
  });

  it('does nothing when the question is answered no', async () => {
    const user = userEvent.setup();
    confirm.mockReturnValue(false);
    const before = store().doc;
    await user.click(screen.getByRole('button', { name: 'Discard…' }));
    await user.click(screen.getByRole('button', { name: 'Ship…' }));
    expect(store().doc).toBe(before);
    expect(saveCheckpoint).not.toHaveBeenCalled();
  });
});
