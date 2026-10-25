// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReactFlowProvider } from '@xyflow/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DialogHost } from '../dialogs/DialogHost';
import { useCanvasStore } from '../store/canvasStore';
import { useUiStore } from '../store/uiStore';
import { shopDoc } from '../test/fixtures';
import { ApiPanel } from './ApiPanel';

const store = () => useCanvasStore.getState();
const ui = () => useUiStore.getState();
const history = () => useCanvasStore.temporal.getState().pastStates.length;
const model = (name: string) => store().doc.models.find((m) => m.name === name);
const endpoint = (id: string) => {
  const n = store().doc.nodes.find((n) => n.id === id);
  if (n?.type !== 'endpoint') throw new Error('not an endpoint');
  return n;
};

beforeEach(() => {
  store().load(shopDoc(), 1, 'p1');
  useUiStore.setState({ dialog: null, selection: [] });
  render(
    <ReactFlowProvider>
      <ApiPanel />
      <DialogHost />
    </ReactFlowProvider>,
  );
});

afterEach(cleanup);

describe('models', () => {
  it('creates a model generated from a table, in one undo step', async () => {
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'New model' }));
    await user.selectOptions(screen.getByLabelText('Source table'), 'orders');
    await user.click(screen.getByRole('button', { name: 'Generate' }));
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('OrdersDto');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(model('OrdersDto')).toMatchObject({ sourceTableId: 'orders', fields: [{ name: 'id' }, { name: 'userId' }] });
    expect(history()).toBe(1);
    // Listed in the panel
    expect(screen.getByText('OrdersDto')).toBeTruthy();
  });

  it('shows duplicate names inline and keeps the dialog open', async () => {
    const user = userEvent.setup();
    act(() => store().upsertModel({ id: 'm', name: 'OrderDto', fields: [] }));
    await user.click(screen.getByRole('button', { name: 'New model' }));
    await user.type(screen.getByLabelText('Name'), 'OrderDto');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText('Duplicate model OrderDto')).toBeTruthy();
    expect(store().doc.models).toHaveLength(1);
  });

  it('blocks deleting a model that is in use and says where', async () => {
    const user = userEvent.setup();
    act(() => {
      store().upsertModel({ id: 'm', name: 'OrderDto', fields: [] });
      const get = endpoint('get');
      store().editNode({
        ...get,
        data: { ...get.data, spec: { ...get.data.spec, responses: [{ status: '200', description: '', body: { kind: 'ref', modelId: 'm' } }] } },
      });
    });
    await user.click(screen.getByRole('button', { name: /^OrderDto/ }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByText('Can’t delete: used by GET /orders 200 response')).toBeTruthy();
    expect(model('OrderDto')).toBeDefined();
  });
});

describe('endpoint tabs', () => {
  it('adds a query param, a body model and a typed response', async () => {
    const user = userEvent.setup();
    act(() => store().upsertModel({ id: 'm', name: 'OrderDto', fields: [] }));
    await user.click(screen.getByRole('button', { name: 'POST /orders' }));
    expect(ui().dialog).toEqual({ kind: 'endpoint', id: 'post' });

    await user.click(screen.getByRole('tab', { name: 'Params' }));
    await user.click(screen.getByRole('button', { name: 'Query param' }));
    await user.type(screen.getByLabelText('Parameter name'), 'dryRun');

    await user.click(screen.getByRole('tab', { name: 'Body' }));
    await user.click(screen.getByLabelText('This endpoint takes a request body'));
    await user.selectOptions(screen.getByLabelText('Body type'), 'OrderDto');

    await user.click(screen.getByRole('tab', { name: 'Responses' }));
    await user.clear(screen.getByLabelText('Status'));
    await user.type(screen.getByLabelText('Status'), '201');
    await user.click(screen.getByRole('checkbox', { name: 'Body' }));
    await user.selectOptions(screen.getByLabelText('Body of 201'), 'OrderDto');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const spec = endpoint('post').data.spec;
    expect(spec.params).toMatchObject([{ name: 'dryRun', in: 'query' }]);
    expect(spec.requestBody).toMatchObject({ type: { kind: 'ref', modelId: 'm' } });
    expect(spec.responses).toMatchObject([{ status: '201', body: { kind: 'ref', modelId: 'm' } }]);
  });

  it('flags the tab holding an error', async () => {
    const user = userEvent.setup();
    act(() => ui().openDialog({ kind: 'endpoint', id: 'get' }));
    await user.click(screen.getByRole('tab', { name: 'Responses' }));
    await user.click(screen.getByRole('button', { name: 'Add response' }));
    await user.type(screen.getAllByLabelText('Status')[1]!, '200');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText('Duplicate response 200')).toBeTruthy();
    expect(within(screen.getByRole('tab', { name: /Responses/ })).getByLabelText('has errors')).toBeTruthy();
  });
});

describe('spec preview', () => {
  it('shows the live spec, switches format and applies settings in one undo step', async () => {
    const user = userEvent.setup();
    act(() => ui().openDialog({ kind: 'spec' }));
    const code = await screen.findByLabelText('OpenAPI spec (YAML)');
    expect(code.textContent).toContain('openapi: 3.1.0');
    expect(code.textContent).toContain('/orders:');

    await user.click(screen.getByRole('radio', { name: 'json' }));
    await waitFor(() => expect(screen.getByLabelText('OpenAPI spec (JSON)').textContent).toContain('"openapi": "3.1.0"'));

    await user.click(screen.getByRole('button', { name: /API settings/ }));
    const title = screen.getByLabelText('Title');
    await user.clear(title);
    await user.type(title, 'Shop API');
    // The preview follows the draft before it's applied
    await waitFor(() => expect(screen.getByLabelText('OpenAPI spec (JSON)').textContent).toContain('"title": "Shop API"'));
    expect(store().doc.api.title).toBe('Untitled API');

    const before = history();
    await user.click(screen.getByRole('button', { name: 'Apply settings' }));
    expect(store().doc.api.title).toBe('Shop API');
    expect(history()).toBe(before + 1);
  });
});
