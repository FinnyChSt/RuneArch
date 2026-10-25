import { CanvasNode, emptyCanvas, type NodeType } from '@flowcanvas/shared';
import { describe, expect, it } from 'vitest';
import { checkConnection, inferEdgeKind } from './connectRules';

const DATA: Record<NodeType, object> = {
  screen: {},
  component: {},
  store: {},
  endpoint: { method: 'GET', path: '/x' },
  service: {},
  job: { trigger: 'queue' },
  external: {},
  table: {},
  frame: {},
  sketch: { shape: 'rect' },
};

const node = (type: NodeType, id: string = type) =>
  CanvasNode.parse({ id, type, position: { x: 0, y: 0 }, data: DATA[type] });

describe('inferEdgeKind', () => {
  it.each([
    ['screen', 'screen', 'navigates'],
    ['screen', 'endpoint', 'calls'],
    ['component', 'endpoint', 'calls'],
    ['store', 'endpoint', 'calls'],
    ['endpoint', 'service', 'calls'],
    ['endpoint', 'external', 'calls'],
    ['service', 'service', 'calls'],
    ['service', 'external', 'calls'],
    ['endpoint', 'table', 'writes'],
    ['service', 'table', 'writes'],
    ['job', 'table', 'writes'],
    ['endpoint', 'job', 'emits'],
    ['screen', 'job', 'emits'],
    ['sketch', 'table', 'arrow'],
    ['screen', 'sketch', 'arrow'],
    ['table', 'endpoint', 'reads'],
    ['table', 'service', 'reads'],
    ['table', 'job', 'reads'],
    ['table', 'external', 'calls'], // fallback until the kind picker exists
  ] as const)('%s → %s = %s', (s, t, kind) => {
    expect(inferEdgeKind(node(s, 'a'), node(t, 'b'))).toEqual({ ok: true, kind });
  });

  it.each([
    ['table', 'table'],
    ['frame', 'screen'],
    ['service', 'frame'],
  ] as const)('rejects %s → %s', (s, t) => {
    expect(inferEdgeKind(node(s, 'a'), node(t, 'b')).ok).toBe(false);
  });
});

describe('checkConnection', () => {
  const doc = { ...emptyCanvas(), nodes: [node('screen', 'a'), node('endpoint', 'b')] };

  it('accepts a valid connection', () => {
    expect(checkConnection(doc, { source: 'a', target: 'b' })).toEqual({ ok: true, kind: 'calls' });
  });

  it('rejects self-loops, unknown nodes and duplicates', () => {
    expect(checkConnection(doc, { source: 'a', target: 'a' }).ok).toBe(false);
    expect(checkConnection(doc, { source: 'a', target: 'zzz' }).ok).toBe(false);
    const connected = { ...doc, edges: [{ id: 'e', kind: 'calls' as const, source: 'a', target: 'b' }] };
    expect(checkConnection(connected, { source: 'a', target: 'b' }).ok).toBe(false);
  });

  it('allows the way back from a table once, as reads', () => {
    const writes = { id: 'w', kind: 'writes' as const, source: 's', target: 't' };
    const pair = { ...emptyCanvas(), nodes: [node('service', 's'), node('table', 't')], edges: [writes] };
    expect(checkConnection(pair, { source: 't', target: 's' })).toEqual({ ok: true, kind: 'reads' });
    const both = { ...pair, edges: [writes, { id: 'r', kind: 'reads' as const, source: 't', target: 's' }] };
    expect(checkConnection(both, { source: 't', target: 's' })).toEqual({
      ok: false,
      reason: 'These nodes are already connected',
    });
  });
});

describe('foreign keys', () => {
  const table = (id: string, columns: { id: string; primaryKey?: boolean; unique?: boolean }[]) =>
    CanvasNode.parse({
      id,
      type: 'table',
      label: id,
      position: { x: 0, y: 0 },
      data: { columns: columns.map((c) => ({ name: c.id, type: 'uuid', ...c })) },
    });
  const doc = {
    ...emptyCanvas(),
    nodes: [
      table('users', [{ id: 'u_id', primaryKey: true }]),
      table('orders', [{ id: 'o_user' }, { id: 'o_ref', unique: true }]),
      table('employees', [{ id: 'e_id', primaryKey: true }, { id: 'e_manager' }]),
      node('screen', 's'),
    ],
  };
  const fk = (source: string, sourceCol: string, target: string, targetCol: string) =>
    checkConnection(doc, { source, target, sourceHandle: `col:${sourceCol}`, targetHandle: `col:${targetCol}` });

  it('connects column to column as an n:1 foreign key', () => {
    expect(fk('orders', 'o_user', 'users', 'u_id')).toEqual({
      ok: true,
      kind: 'fk',
      data: { sourceColumnId: 'o_user', targetColumnId: 'u_id', cardinality: 'n:1', onDelete: 'no action' },
    });
  });

  it('uses 1:1 when the referencing column is unique or a key', () => {
    expect(fk('orders', 'o_ref', 'users', 'u_id')).toMatchObject({ ok: true, data: { cardinality: '1:1' } });
  });

  it('allows self-references between different columns', () => {
    expect(fk('employees', 'e_manager', 'employees', 'e_id')).toMatchObject({ ok: true, kind: 'fk' });
    expect(fk('employees', 'e_id', 'employees', 'e_id').ok).toBe(false);
  });

  it('rejects mixing column and node handles, unknown columns and duplicates', () => {
    expect(checkConnection(doc, { source: 'orders', target: 'users', sourceHandle: 'col:o_user', targetHandle: 'l' }).ok).toBe(
      false,
    );
    expect(fk('orders', 'nope', 'users', 'u_id').ok).toBe(false);
    const withFk = {
      ...doc,
      edges: [
        {
          id: 'e',
          kind: 'fk' as const,
          source: 'orders',
          target: 'users',
          data: { sourceColumnId: 'o_user', targetColumnId: 'u_id', cardinality: 'n:1' as const, onDelete: 'no action' as const },
        },
      ],
    };
    expect(
      checkConnection(withFk, { source: 'orders', target: 'users', sourceHandle: 'col:o_user', targetHandle: 'col:u_id' }),
    ).toEqual({ ok: false, reason: 'This foreign key already exists' });
  });

  it('points table-to-table drags at the column handles', () => {
    expect(checkConnection(doc, { source: 'orders', target: 'users' })).toEqual({
      ok: false,
      reason: 'Drag from one column to another to create a foreign key',
    });
  });
});
