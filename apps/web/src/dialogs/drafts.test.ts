import { emptyCanvas, type TableNode } from '@flowcanvas/shared';
import { describe, expect, it } from 'vitest';
import type { NodeOf } from '../canvas/mapping';
import { replaceNode } from '../store/docOps';
import { shopDoc } from '../test/fixtures';
import {
  endpointMapper,
  fromEndpointDraft,
  fromScreenDraft,
  cronHint,
  fromJobDraft,
  fromServiceDraft,
  toEndpointDraft,
  toScreenDraft,
  toJobDraft,
  toServiceDraft,
} from './drafts';
import { buildTableDoc, newColumnDraft, referenceOptions, tableMapper, toTableDraft } from './tableDraft';
import { validateDraft } from './validation';

const endpoint = (id: string) => shopDoc().nodes.find((n) => n.id === id) as NodeOf<'endpoint'>;
const tableOf = (id: string) => shopDoc().nodes.find((n) => n.id === id) as TableNode;

describe('screen draft', () => {
  it('round-trips and normalizes text', () => {
    const node = {
      id: 's',
      type: 'screen' as const,
      position: { x: 0, y: 0 },
      label: 'Cart',
      data: { route: '/cart', state: ['items'] },
    };
    const draft = { ...toScreenDraft(node, emptyCanvas()), state: 'items\n\n  total  \n', route: '  ', notes: ' hi ' };
    expect(fromScreenDraft(node, draft)).toEqual({
      ...node,
      notes: 'hi',
      data: { route: undefined, state: ['items', 'total'] },
    });
  });
});

describe('service draft', () => {
  it('round-trips and normalizes text', () => {
    const node = {
      id: 'svc',
      type: 'service' as const,
      position: { x: 0, y: 0 },
      label: 'OrderService',
      notes: 'old',
      data: { methods: ['create'] },
    };
    expect(toServiceDraft(node)).toEqual({ label: 'OrderService', methods: 'create', notes: 'old' });
    const draft = { label: '  Billing  ', methods: 'charge\n\n  refund  \n', notes: '  ' };
    expect(fromServiceDraft(node, draft)).toEqual({
      ...node,
      label: 'Billing',
      notes: undefined,
      data: { methods: ['charge', 'refund'] },
    });
  });
});

describe('job draft', () => {
  const node = {
    id: 'job',
    type: 'job' as const,
    position: { x: 0, y: 0 },
    label: 'cleanup',
    data: { trigger: 'cron' as const, schedule: '0 3 * * *' },
  };

  it('round-trips and tidies the schedule', () => {
    expect(toJobDraft(node)).toEqual({ label: 'cleanup', trigger: 'cron', schedule: '0 3 * * *', notes: '' });
    const draft = { label: ' purge ', trigger: 'cron' as const, schedule: '  */5   *  * * * ', notes: ' nightly ' };
    expect(fromJobDraft(node, draft)).toEqual({
      ...node,
      label: 'purge',
      notes: 'nightly',
      data: { trigger: 'cron', schedule: '*/5 * * * *' },
    });
  });

  it('drops the schedule for events and queue jobs, and a blank one', () => {
    expect(fromJobDraft(node, { ...toJobDraft(node), trigger: 'queue' }).data).toEqual({ trigger: 'queue', schedule: undefined });
    expect(fromJobDraft(node, { ...toJobDraft(node), schedule: '  ' }).data.schedule).toBeUndefined();
  });

  it('hints at cron expressions with the wrong number of fields', () => {
    expect(cronHint('')).toBeNull();
    expect(cronHint('0 3 * * *')).toBeNull();
    expect(cronHint('0 0 3 * * *')).toBeNull();
    expect(cronHint('@daily')).toBeNull();
    expect(cronHint('0 3 *')).toMatch(/got 3/);
  });
});

describe('endpoint draft', () => {
  it('syncs path params from the path and splits tags', () => {
    const node = endpoint('get');
    const next = fromEndpointDraft(node, { ...toEndpointDraft(node), path: '/orders/{orderId}', tags: 'orders, , orders, admin' });
    expect(next.data.spec.params.map((p) => [p.name, p.in, p.required])).toEqual([['orderId', 'path', true]]);
    expect(next.data.spec.tags).toEqual(['orders', 'admin']);
  });

  it('reports a duplicate route on the path field', () => {
    const doc = shopDoc();
    const node = endpoint('get');
    const candidate = replaceNode(doc, fromEndpointDraft(node, { ...toEndpointDraft(node), method: 'POST' }));
    expect(validateDraft(candidate, 'get', endpointMapper).fields).toEqual({ path: 'Duplicate route POST /orders' });
  });

  it('reports field-level schema errors', () => {
    const doc = shopDoc();
    const node = endpoint('get');
    const candidate = replaceNode(doc, fromEndpointDraft(node, { ...toEndpointDraft(node), path: 'orders' }));
    expect(validateDraft(candidate, 'get', endpointMapper).fields).toEqual({ path: 'Path must start with /' });
  });
});

describe('table draft', () => {
  it('carries each column foreign key in the draft', () => {
    const draft = toTableDraft(tableOf('orders'), shopDoc());
    expect(draft.columns.map((c) => [c.name, c.ref])).toEqual([
      ['id', ''],
      ['user_id', 'users::u_id'],
    ]);
  });

  it('maps column, index and FK issues to their fields', () => {
    const doc = shopDoc();
    const orders = tableOf('orders');
    const draft = toTableDraft(orders, doc);
    draft.columns[0]!.name = 'user_id';
    draft.columns.push({ ...newColumnDraft(), name: '', ref: 'users::gone' });
    draft.indexes[0]!.columnIds = [];

    const candidate = buildTableDoc(doc, orders, draft);
    expect(validateDraft(candidate, 'orders', tableMapper('orders', draft))).toEqual({
      fields: {
        'columns.1.name': 'Duplicate column user_id',
        'columns.2.name': 'Column name is required',
        'indexes.0.columnIds': 'Pick at least one column',
        'columns.2.ref': 'Unknown target column',
      },
      other: [],
    });
  });

  it('removing a column drops it from indexes and its FK', () => {
    const doc = shopDoc();
    const orders = tableOf('orders');
    const draft = toTableDraft(orders, doc);
    draft.columns = draft.columns.filter((c) => c.name !== 'user_id');
    const candidate = buildTableDoc(doc, orders, draft);
    expect(candidate.edges.map((e) => e.id)).toEqual(['w']);
    expect((candidate.nodes.find((n) => n.id === 'orders') as TableNode).data.indexes[0]!.columnIds).toEqual([]);
  });

  it('offers every named column as a reference, using draft names for the edited table', () => {
    const doc = shopDoc();
    const draft = toTableDraft(tableOf('orders'), doc);
    draft.label = 'purchases';
    expect(referenceOptions(doc, 'orders', draft).map((o) => o.label)).toEqual([
      'users.id',
      'users.email',
      'purchases.id',
      'purchases.user_id',
    ]);
  });
});
