// @vitest-environment jsdom
import { emptyCanvas } from '@flowcanvas/shared';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useCanvasStore } from '../store/canvasStore';
import { useUiStore } from '../store/uiStore';
import { SelectionBar } from './SelectionBar';

const store = () => useCanvasStore.getState();
const node = (id: string) => store().doc.nodes.find((n) => n.id === id)!;

let ids: string[] = [];
beforeEach(() => {
  store().load(emptyCanvas(), 1, 'p1');
  ids = [store().addNode('rect', { x: 0, y: 0 }), store().addNode('rect', { x: 300, y: 80 }), store().addNode('rect', { x: 90, y: 200 })];
  useUiStore.setState({ selection: [] });
  render(<SelectionBar />);
});
afterEach(cleanup);

describe('selection bar', () => {
  it('shows for two or more nodes and aligns them in one undo step', async () => {
    expect(screen.queryByRole('toolbar')).toBeNull();
    act(() => useUiStore.getState().setSelection(ids));
    const before = useCanvasStore.temporal.getState().pastStates.length;
    await userEvent.click(screen.getByRole('button', { name: 'Align top' }));
    expect(ids.map((id) => node(id).position.y)).toEqual([0, 0, 0]);
    expect(useCanvasStore.temporal.getState().pastStates.length).toBe(before + 1);
  });

  it('distributes three nodes, groups them, then ungroups', async () => {
    act(() => useUiStore.getState().setSelection(ids));
    await userEvent.click(screen.getByRole('button', { name: 'Distribute horizontally' }));
    expect(ids.map((id) => node(id).position.x)).toEqual([0, 300, 150]);

    await userEvent.click(screen.getByRole('button', { name: 'Group in a frame (Ctrl+G)' }));
    const [frame] = useUiStore.getState().selection;
    expect(node(frame!).type).toBe('frame');
    expect(ids.every((id) => node(id).parentId === frame)).toBe(true);

    await userEvent.click(screen.getByRole('button', { name: 'Ungroup (Ctrl+Shift+G)' }));
    expect(ids.map((id) => node(id).position.x)).toEqual([0, 300, 150]);
    expect(useUiStore.getState().selection).toEqual(ids);
  });
});
