// @vitest-environment jsdom
import { CanvasDoc, type TableNode } from '@flowcanvas/shared';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReactFlowProvider } from '@xyflow/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useShortcuts } from '../hooks/useShortcuts';
import { useCanvasStore } from '../store/canvasStore';
import { useUiStore } from '../store/uiStore';
import { checkoutDoc, shopDoc, wireframedCheckoutDoc } from '../test/fixtures';
import { DialogHost } from './DialogHost';
import { openNodeDialog } from './openNodeDialog';

const store = () => useCanvasStore.getState();
const history = () => useCanvasStore.temporal.getState().pastStates.length;
const node = (id: string) => store().doc.nodes.find((n) => n.id === id)!;

const svc = {
  id: 'svc',
  type: 'service' as const,
  position: { x: 0, y: 600 },
  label: 'OrderService',
  data: { methods: ['charge'] },
};

function Harness() {
  useShortcuts();
  return <DialogHost />;
}

function open(id: string, focusColumnId?: string) {
  const kind = node(id).type as 'table' | 'endpoint' | 'screen' | 'service';
  act(() => useUiStore.getState().openDialog({ kind, id, focusColumnId }));
}

beforeEach(() => {
  store().load(shopDoc(), 1, 'p1');
  useUiStore.setState({ dialog: null, selection: [] });
  render(
    <ReactFlowProvider>
      <Harness />
    </ReactFlowProvider>,
  );
});

afterEach(cleanup);

describe('table dialog', () => {
  it('renaming a column keeps its foreign key, in one undo step', async () => {
    const user = userEvent.setup();
    open('orders');
    const [, userId] = screen.getAllByLabelText('Column name');
    await user.clear(userId!);
    await user.type(userId!, 'customer_id');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(useUiStore.getState().dialog).toBeNull();
    expect((node('orders') as TableNode).data.columns[1]!.name).toBe('customer_id');
    expect(store().doc.edges.find((e) => e.id === 'fk')).toMatchObject({
      data: { sourceColumnId: 'o_user', targetColumnId: 'u_id' },
    });
    expect(history()).toBe(1);
  });

  it('shows validation errors inline and does not save', async () => {
    const user = userEvent.setup();
    const before = store().doc;
    open('orders');
    const [, userId] = screen.getAllByLabelText('Column name');
    await user.clear(userId!);
    await user.type(userId!, 'id');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByText('Duplicate column id')).toBeTruthy();
    expect(userId!.getAttribute('aria-invalid')).toBe('true');
    expect(store().doc).toBe(before);
    expect(useUiStore.getState().dialog).not.toBeNull();
  });

  it('adds a foreign key from the References picker', async () => {
    const user = userEvent.setup();
    open('users');
    await user.selectOptions(screen.getByLabelText('email references'), 'orders.user_id');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(store().doc.edges.filter((e) => e.kind === 'fk' && e.source === 'users')).toMatchObject([
      { target: 'orders', data: { sourceColumnId: 'u_email', targetColumnId: 'o_user', cardinality: '1:1' } },
    ]);
  });

  it('removing a referenced column removes the FK edges pointing at it', async () => {
    const user = userEvent.setup();
    open('users');
    await user.click(screen.getByRole('button', { name: 'Remove id' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(store().doc.edges.some((e) => e.kind === 'fk')).toBe(false);
  });

  it('focuses the column when opened from an FK edge', async () => {
    open('orders', 'o_user');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('user_id references')));
  });

  it('shows generated SQL', async () => {
    const user = userEvent.setup();
    open('orders');
    await user.click(screen.getByRole('tab', { name: 'SQL' }));
    expect(screen.getByLabelText('Generated SQL').textContent).toContain(
      'FOREIGN KEY (user_id) REFERENCES users (id)',
    );
  });
});

describe('endpoint dialog', () => {
  it('shows doc-wide errors (duplicate route) inline while editing', async () => {
    const user = userEvent.setup();
    open('get');
    await user.selectOptions(screen.getByLabelText('Method'), 'POST');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText('Duplicate route POST /orders')).toBeTruthy();
    expect(node('get').type === 'endpoint' && node('get')).toMatchObject({ data: { method: 'GET' } });
  });

  it('syncs path params on save', async () => {
    const user = userEvent.setup();
    open('get');
    const path = screen.getByLabelText('Path');
    await user.clear(path);
    await user.type(path, '/orders/{{orderId}');
    await user.click(screen.getByRole('tab', { name: 'Params' }));
    expect(screen.getByTitle('From the path').textContent).toBe('orderId');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const saved = node('get');
    expect(saved.type === 'endpoint' && saved.data.spec.params.map((p) => p.name)).toEqual(['orderId']);
  });

  it('Cancel and Escape discard the draft', async () => {
    const user = userEvent.setup();
    const before = store().doc;
    open('get');
    await user.type(screen.getByLabelText('Summary'), 'List orders');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(store().doc).toBe(before);

    open('get');
    await user.type(screen.getByLabelText('Summary'), 'List orders');
    await user.keyboard('{Escape}');
    expect(useUiStore.getState().dialog).toBeNull();
    expect(store().doc).toBe(before);
  });
});

describe('screen dialog', () => {
  beforeEach(() => store().load(checkoutDoc(), 1, 'p1'));

  const wireframeOf = (id: string) => {
    const n = node(id);
    return n.type === 'screen' ? n.data.wireframe : undefined;
  };

  it('adds a wireframe from a template in one undo step', async () => {
    const user = userEvent.setup();
    const before = history();
    open('cart');
    await user.click(screen.getByRole('tab', { name: 'Wireframe' }));
    await user.click(screen.getByRole('radio', { name: 'Mobile' }));
    await user.click(screen.getByRole('button', { name: 'Login template' }));
    expect(screen.getByRole('button', { name: 'Button: Sign in' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const wireframe = wireframeOf('cart');
    expect(wireframe?.device).toBe('mobile');
    expect(wireframe?.elements.map((e) => e.text)).toContain('Sign in');
    expect(history()).toBe(before + 1);
  });

  it('switches device and removes the wireframe', async () => {
    const user = userEvent.setup();
    open('cart');
    await user.click(screen.getByRole('tab', { name: 'Wireframe' }));
    await user.click(screen.getByRole('button', { name: 'List template' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    open('cart');
    await user.click(screen.getByRole('tab', { name: 'Wireframe' }));
    await user.click(screen.getByRole('radio', { name: 'Tablet' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(wireframeOf('cart')?.device).toBe('tablet');

    open('cart');
    await user.click(screen.getByRole('tab', { name: 'Wireframe' }));
    await user.click(screen.getByRole('button', { name: 'Remove wireframe' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(wireframeOf('cart')).toBeUndefined();
  });
});

describe('wireframe editor', () => {
  beforeEach(() => store().load(checkoutDoc(), 1, 'p1'));

  const elementsOf = (id: string) => {
    const n = node(id);
    return n.type === 'screen' ? (n.data.wireframe?.elements ?? []) : [];
  };

  async function openBlank() {
    const user = userEvent.setup();
    open('cart');
    await user.click(screen.getByRole('tab', { name: 'Wireframe' }));
    await user.click(screen.getByRole('button', { name: 'Blank template' }));
    return user;
  }

  it('adds elements from the palette and edits them in the inspector', async () => {
    const user = await openBlank();
    await user.click(screen.getByRole('button', { name: 'Add Input' }));
    await user.click(screen.getByRole('button', { name: 'Add Button' }));
    const label = screen.getByLabelText('Label');
    await user.clear(label);
    await user.type(label, 'Place order');
    await user.selectOptions(screen.getByLabelText('Style'), 'secondary');
    expect(screen.getByRole('button', { name: 'Button: Place order', pressed: true })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(elementsOf('cart').map((e) => [e.kind, e.text, e.variant])).toEqual([
      ['input', 'Placeholder', undefined],
      ['button', 'Place order', 'secondary'],
    ]);
    // Stacked: the button starts below the input
    expect(elementsOf('cart')[1]?.rect).toEqual({ x: 0, y: 6, w: 3, h: 5 });
  });

  it('nudges, duplicates and deletes with the keyboard, with undo inside the draft', async () => {
    const user = await openBlank();
    await user.click(screen.getByRole('button', { name: 'Add Button' }));
    const frame = screen.getByRole('application', { name: 'Wireframe' });
    expect(document.activeElement).toBe(frame);

    await user.keyboard('{ArrowRight}{ArrowRight}{ArrowDown}');
    expect(screen.getByLabelText('X (column)')).toHaveProperty('value', '2');
    expect(screen.getByLabelText('Y (row)')).toHaveProperty('value', '1');
    await user.keyboard('{Control>}d{/Control}');
    expect(screen.getAllByRole('button', { name: 'Button: Button' })).toHaveLength(2);
    await user.keyboard('{Delete}');
    expect(screen.getAllByRole('button', { name: 'Button: Button' })).toHaveLength(1);

    // Undo the delete, then the duplicate; the three nudges were one step
    await user.keyboard('{Control>}z{/Control}');
    expect(screen.getAllByRole('button', { name: 'Button: Button' })).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Undo wireframe change' }));
    await user.click(screen.getByRole('button', { name: 'Undo wireframe change' }));
    await user.click(screen.getAllByRole('button', { name: 'Button: Button' })[0]!);
    expect(screen.getByLabelText('X (column)')).toHaveProperty('value', '0');

    const before = history();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(elementsOf('cart')).toHaveLength(1);
    expect(history()).toBe(before + 1);
  });

  it('Cancel discards all wireframe edits', async () => {
    const user = await openBlank();
    await user.click(screen.getByRole('button', { name: 'Add Heading' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(node('cart')).toEqual(checkoutDoc().nodes.find((n) => n.id === 'cart'));
  });
});

describe('wireframe export', () => {
  it('downloads the draft wireframe as SVG named after the screen', async () => {
    store().load(wireframedCheckoutDoc(), 1, 'p1');
    const blobs: Blob[] = [];
    const saved: string[] = [];
    URL.createObjectURL = (blob: Blob) => (blobs.push(blob), 'blob:x');
    URL.revokeObjectURL = () => {};
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      saved.push(this.download);
    };
    try {
      const user = userEvent.setup();
      open('cart');
      await user.click(screen.getByRole('tab', { name: 'Wireframe' }));
      await user.click(screen.getByRole('button', { name: 'SVG' }));
      expect(saved).toEqual(['cart-wireframe.svg']);
      expect(blobs[0]?.type).toBe('image/svg+xml');
      expect(await blobs[0]!.text()).toContain('Place order');
    } finally {
      HTMLAnchorElement.prototype.click = click;
    }
  });
});

describe('element links', () => {
  beforeEach(() => store().load(wireframedCheckoutDoc(), 1, 'p1'));

  const elementEdges = () => store().doc.edges.filter((e) => e.sourceHandle?.startsWith('el:'));

  async function openButton() {
    const user = userEvent.setup();
    open('cart');
    await user.click(screen.getByRole('tab', { name: 'Wireframe' }));
    await user.click(screen.getByRole('button', { name: 'Button: Place order' }));
    return user;
  }

  it('lists, adds and removes what an element does on click, in one undo step', async () => {
    const user = await openButton();
    expect(screen.getByText('POST /orders')).toBeTruthy();
    expect(screen.getAllByLabelText('Has links')).toHaveLength(1);
    await user.selectOptions(screen.getByLabelText('Add link'), 'home');
    await user.click(screen.getByRole('button', { name: 'Remove link to POST /orders' }));

    const before = history();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(history()).toBe(before + 1);
    expect(elementEdges().map((e) => [e.kind, e.target, e.sourceHandle])).toEqual([['navigates', 'home', 'el:place']]);
  });

  it('only interactive elements offer links', async () => {
    const user = await openButton();
    await user.click(screen.getByRole('button', { name: 'Image' }));
    expect(screen.queryByLabelText('Add link')).toBeNull();
  });

  it('deleting an element drops its links; undo brings them back', async () => {
    const user = await openButton();
    await user.keyboard('{Delete}');
    expect(screen.queryByLabelText('Has links')).toBeNull();
    await user.keyboard('{Control>}z{/Control}');
    expect(screen.getAllByLabelText('Has links')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Button: Place order' }));
    await user.keyboard('{Delete}');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(elementEdges()).toEqual([]);
  });
});

describe('generate from endpoint', () => {
  beforeEach(() => {
    const doc = wireframedCheckoutDoc();
    const str = { kind: 'primitive', type: 'string' };
    const withApi = CanvasDoc.parse({
      ...doc,
      models: [
        { id: 'create', name: 'CreateOrderDto', fields: [{ id: 'a', name: 'address', type: str }] },
        { id: 'order', name: 'OrderDto', fields: [{ id: 'b', name: 'status', type: str }] },
      ],
      nodes: [
        ...doc.nodes.map((n) =>
          n.id === 'post' && n.type === 'endpoint'
            ? { ...n, data: { ...n.data, spec: { ...n.data.spec, requestBody: { type: { kind: 'ref', modelId: 'create' } } } } }
            : n,
        ),
        {
          id: 'list',
          type: 'endpoint',
          position: { x: 300, y: 300 },
          data: {
            method: 'GET',
            path: '/orders',
            spec: { responses: [{ status: '200', body: { kind: 'array', items: { kind: 'ref', modelId: 'order' } } }] },
          },
        },
      ],
    });
    store().load(withApi, 1, 'p1');
  });

  const cart = () => {
    const n = node('cart');
    return n.type === 'screen' ? (n.data.wireframe?.elements ?? []) : [];
  };

  async function openGenerator() {
    const user = userEvent.setup();
    open('cart');
    await user.click(screen.getByRole('tab', { name: 'Wireframe' }));
    await user.click(screen.getByRole('button', { name: 'From endpoint' }));
    return user;
  }

  it('adds a form whose submit button calls the endpoint, in one undo step', async () => {
    const user = await openGenerator();
    await user.selectOptions(screen.getByLabelText('Endpoint'), 'post');
    expect(screen.getByRole('button', { name: 'List' })).toHaveProperty('disabled', true);
    await user.click(screen.getByRole('button', { name: 'Form' }));
    expect(screen.queryByRole('group', { name: 'Generate from endpoint' })).toBeNull();

    const before = history();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(history()).toBe(before + 1);
    const added = cart().slice(3);
    expect(added.map((e) => [e.kind, e.text, e.modelRef])).toEqual([
      ['form', 'Create order', 'create'],
      ['input', 'Address', undefined],
      ['button', 'Create', undefined],
    ]);
    const submit = added[2]!;
    expect(store().doc.edges.filter((e) => e.sourceHandle === `el:${submit.id}`).map((e) => [e.kind, e.target])).toEqual([
      ['calls', 'post'],
    ]);
  });

  it('adds a table for a list response and shows its model in the inspector', async () => {
    const user = await openGenerator();
    await user.selectOptions(screen.getByLabelText('Endpoint'), 'list');
    expect(screen.getByRole('button', { name: 'Form' })).toHaveProperty('disabled', true);
    await user.click(screen.getByRole('button', { name: 'Table' }));
    await user.click(screen.getByRole('button', { name: 'Table' }));
    expect((screen.getByLabelText('Model') as HTMLSelectElement).value).toBe('order');
    await user.selectOptions(screen.getByLabelText('Model'), '');
    await user.click(screen.getByRole('button', { name: 'Undo wireframe change' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(cart().at(-1)).toMatchObject({ kind: 'table', items: ['Status'], modelRef: 'order' });
  });
});

describe('component wireframes', () => {
  beforeEach(() => {
    const doc = wireframedCheckoutDoc();
    store().load(
      CanvasDoc.parse({
        ...doc,
        nodes: [...doc.nodes, { id: 'card', type: 'component', label: 'ProductCard', position: { x: 0, y: 600 }, data: {} }],
      }),
      1,
      'p1',
    );
  });

  const elementsOf = (id: string) => {
    const n = node(id);
    return n.type === 'screen' || n.type === 'component' ? (n.data.wireframe?.elements ?? []) : [];
  };

  it('edits a component layout, places it on a screen, and deleting the component removes its instances', async () => {
    const user = userEvent.setup();
    open('card');
    await user.click(screen.getByRole('tab', { name: 'Wireframe' }));
    await user.click(screen.getByRole('button', { name: 'Blank template' }));
    // Components don't nest or link
    expect(screen.queryByText('Your components')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Add Button' }));
    expect(screen.queryByLabelText('Add link')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(elementsOf('card').map((e) => e.kind)).toEqual(['button']);

    open('cart');
    await user.click(screen.getByRole('tab', { name: 'Wireframe' }));
    await user.click(screen.getByRole('button', { name: 'Place ProductCard' }));
    expect(screen.getByRole('button', { name: 'Component: ProductCard' })).toBeTruthy();
    expect((screen.getByLabelText('Component') as HTMLSelectElement).value).toBe('card');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(elementsOf('cart').at(-1)).toMatchObject({ kind: 'instance', componentId: 'card', rect: { w: 12 } });

    open('card');
    expect(screen.getByText('Placed on: Cart')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    act(() => store().removeElements(['card']));
    expect(elementsOf('cart').some((e) => e.kind === 'instance')).toBe(false);
  });
});

describe('service dialog', () => {
  it('renames a service and edits its methods in one undo step', async () => {
    const user = userEvent.setup();
    act(() => store().load({ ...shopDoc(), nodes: [...shopDoc().nodes, svc] }, 1, 'p1'));
    const before = history();
    expect(openNodeDialog('svc')).toBe(true);
    await act(async () => {});
    const name = screen.getByLabelText('Name');
    await user.clear(name);
    await user.type(name, 'BillingService');
    await user.type(screen.getByLabelText('Methods'), '{Enter}refund');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(node('svc')).toMatchObject({ label: 'BillingService', data: { methods: ['charge', 'refund'] } });
    expect(history()).toBe(before + 1);
    expect(useUiStore.getState().dialog).toBeNull();
  });
});

describe('job dialog', () => {
  it('turns an event into a scheduled job in one undo step', async () => {
    const user = userEvent.setup();
    act(() => store().load(checkoutDoc(), 1, 'p1'));
    const before = history();
    expect(openNodeDialog('created')).toBe(true);
    await act(async () => {});
    expect(screen.queryByLabelText('Schedule')).toBeNull();
    await user.selectOptions(screen.getByLabelText('Trigger'), 'cron');
    const schedule = screen.getByLabelText('Schedule');
    await user.type(schedule, '0 3 *');
    expect(screen.getByText(/Expected 5 fields/)).toBeTruthy();
    await user.type(schedule, ' * *');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(node('created')).toMatchObject({ data: { trigger: 'cron', schedule: '0 3 * * *' } });
    expect(history()).toBe(before + 1);
    expect(useUiStore.getState().dialog).toBeNull();
  });
});

describe('edge dialog', () => {
  const edge = () => store().doc.edges.find((e) => e.id === 'w')!;
  const openEdge = () => act(() => useUiStore.getState().openDialog({ kind: 'edge', id: 'w' }));

  it('picks CRUD operations; the kind follows them, one undo step per save', async () => {
    const user = userEvent.setup();
    const before = history();
    openEdge();
    await user.click(screen.getByLabelText('read'));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(edge()).toMatchObject({ kind: 'reads', crud: ['read'] });
    expect(history()).toBe(before + 1);

    openEdge();
    await user.click(screen.getByLabelText('update'));
    await user.click(screen.getByLabelText('create'));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(edge()).toMatchObject({ kind: 'writes', crud: ['create', 'read', 'update'] });
  });

  it('clearing all operations keeps the kind and drops the list', async () => {
    const user = userEvent.setup();
    act(() => store().editEdge({ ...edge(), kind: 'writes', crud: ['delete'] } as never));
    openEdge();
    await user.click(screen.getByLabelText('delete'));
    await user.type(screen.getByLabelText('Label'), 'archive');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(edge()).toMatchObject({ kind: 'writes', label: 'archive' });
    expect(edge()).not.toHaveProperty('crud', expect.anything());
  });
});

describe('dialog host', () => {
  it('pauses canvas shortcuts while a dialog is open', async () => {
    const user = userEvent.setup();
    act(() => useUiStore.getState().setSelection(['get']));
    open('get');
    screen.getByRole('radio', { name: 'Public' }).focus();
    await user.keyboard('{Delete}');
    expect(store().doc.nodes.some((n) => n.id === 'get')).toBe(true);
  });

  it('closes when its node disappears', () => {
    open('get');
    act(() => store().removeElements(['get']));
    expect(useUiStore.getState().dialog).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
