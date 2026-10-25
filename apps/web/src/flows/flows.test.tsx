// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReactFlowProvider } from '@xyflow/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DialogHost } from '../dialogs/DialogHost';
import { useShortcuts } from '../hooks/useShortcuts';
import { useCanvasStore } from '../store/canvasStore';
import { useUiStore } from '../store/uiStore';
import { checkoutDoc } from '../test/fixtures';
import { FlowsPanel } from './FlowsPanel';
import { RecordingBar } from './RecordingBar';

const store = () => useCanvasStore.getState();
const ui = () => useUiStore.getState();
const steps = (id: string) => store().doc.flows.find((f) => f.id === id)!.steps.map((s) => s.edgeId);

function Harness() {
  useShortcuts();
  return (
    <>
      <FlowsPanel />
      <RecordingBar />
      <DialogHost />
    </>
  );
}

/** Adds a recorded "Checkout" flow: cart -> POST /orders -> orders, plus the order.created branch */
function recordCheckout() {
  let id = '';
  act(() => {
    id = store().addFlow({ name: 'Checkout', color: 'teal' });
    for (const e of ['e1', 'e2', 'e3']) store().addFlowStep(id, e);
  });
  return id;
}

beforeEach(() => {
  store().load(checkoutDoc(), 1, 'p1');
  useUiStore.setState({ activeFlowId: null, flowRecording: false, playhead: null, dialog: null, hint: null });
  render(
    <ReactFlowProvider>
      <Harness />
    </ReactFlowProvider>,
  );
});

afterEach(cleanup);

describe('flows panel', () => {
  it('creating a flow starts recording it', async () => {
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'New flow' }));
    await user.type(screen.getByLabelText('Flow name'), 'Checkout');
    await user.click(screen.getByRole('radio', { name: 'rose' }));
    await user.click(screen.getByRole('button', { name: 'Start recording' }));

    const [flow] = store().doc.flows;
    expect(flow).toMatchObject({ name: 'Checkout', color: 'rose', steps: [] });
    expect(ui()).toMatchObject({ activeFlowId: flow!.id, flowRecording: true });
    expect(screen.getByRole('status').textContent).toContain('Recording Checkout · 0 steps');
  });

  it('recording bar removes the last step and finishes', async () => {
    const user = userEvent.setup();
    const id = recordCheckout();
    act(() => ui().startRecording(id));
    await user.click(screen.getByRole('button', { name: 'Remove last step' }));
    expect(steps(id)).toEqual(['e1', 'e2']);
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(ui().flowRecording).toBe(false);
    expect(ui().activeFlowId).toBe(id);
  });

  it('selecting a flow lists its steps; clicking one moves the playhead', async () => {
    const user = userEvent.setup();
    recordCheckout();
    await user.click(screen.getByRole('button', { name: /^Checkout/ }));
    const list = document.querySelector('ol')!;
    expect(within(list).getAllByRole('button').map((b) => b.textContent)).toEqual([
      '1Cart → POST /orders · calls',
      '2POST /orders → orders · writes',
      '3POST /orders → order.created · emits',
    ]);
    await user.click(within(list).getAllByRole('button')[2]!);
    expect(ui().playhead).toBe(2);
  });

  it('"Show whole canvas" leaves the flow view', async () => {
    const user = userEvent.setup();
    const id = recordCheckout();
    act(() => ui().selectFlow(id));
    await user.click(screen.getByRole('button', { name: 'Show whole canvas' }));
    expect(ui()).toMatchObject({ activeFlowId: null, playhead: null });
    expect(screen.queryByRole('button', { name: 'Show whole canvas' })).toBeNull();
  });
});

describe('step-through shortcuts', () => {
  it('→ and ← move the playhead within the flow; Esc clears it', async () => {
    const user = userEvent.setup();
    const id = recordCheckout();
    act(() => ui().selectFlow(id));

    await user.keyboard('{ArrowRight}');
    expect(ui().playhead).toBe(0);
    await user.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}');
    expect(ui().playhead).toBe(2);
    await user.keyboard('{ArrowLeft}');
    expect(ui().playhead).toBe(1);

    await user.keyboard('{Escape}');
    expect(ui()).toMatchObject({ activeFlowId: null, playhead: null });
  });

  it('Esc stops recording before clearing the flow', async () => {
    const user = userEvent.setup();
    const id = recordCheckout();
    act(() => ui().startRecording(id));
    await user.keyboard('{Escape}');
    expect(ui()).toMatchObject({ flowRecording: false, activeFlowId: id });
  });
});

describe('flow dialog', () => {
  it('shows an inline error when reordering breaks the flow, and saves valid edits once', async () => {
    const user = userEvent.setup();
    const id = recordCheckout();
    const before = useCanvasStore.temporal.getState().pastStates.length;
    act(() => ui().openDialog({ kind: 'flow', id }));

    await user.click(screen.getByRole('button', { name: 'Move step 2 up' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText('Step does not continue from a node already in the flow')).toBeTruthy();
    expect(steps(id)).toEqual(['e1', 'e2', 'e3']);

    // Swap back, then reorder the two branches instead (both start at POST /orders)
    await user.click(screen.getByRole('button', { name: 'Move step 2 up' }));
    await user.click(screen.getByRole('button', { name: 'Move step 3 up' }));
    await user.type(screen.getByLabelText('Note for step 2'), 'publish first');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(steps(id)).toEqual(['e1', 'e3', 'e2']);
    expect(store().doc.flows[0]!.steps[1]!.note).toBe('publish first');
    expect(useCanvasStore.temporal.getState().pastStates.length).toBe(before + 1);
  });

  it('deletes the flow after confirmation', async () => {
    const user = userEvent.setup();
    const id = recordCheckout();
    window.confirm = () => true;
    act(() => ui().openDialog({ kind: 'flow', id }));
    await user.click(screen.getByRole('button', { name: 'Delete flow' }));
    expect(store().doc.flows).toEqual([]);
    expect(ui().dialog).toBeNull();
  });
});
