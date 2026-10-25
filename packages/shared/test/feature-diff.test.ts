import { describe, expect, it } from 'vitest';
import {
  ApiModel,
  CanvasNode,
  describeEntry,
  diffModel,
  diffNode,
  revertEntry,
  setPath,
  type DiffEntry,
} from '../src';

const node = (input: unknown) => CanvasNode.parse(input);
const col = (id: string, name: string, type = 'text', extra: object = {}) => ({ id, name, type, ...extra });

const users = node({
  id: 'users',
  type: 'table',
  label: 'users',
  position: { x: 0, y: 0 },
  data: {
    columns: [col('id', 'id', 'uuid', { primaryKey: true, nullable: false }), col('email', 'email'), col('nick', 'nickname')],
    indexes: [{ id: 'ix', columnIds: ['email'] }],
  },
});

const summary = (entries: DiffEntry[]) =>
  entries.map((e) => (e.type === 'prop' ? `${e.label}: ${String(e.before)} → ${String(e.after)}` : `${e.type} ${e.label} ${e.name}${e.fields ? ` (${e.fields.join(', ')})` : ''}`));

describe('diffNode', () => {
  it('lists column, index and property changes of a table; layout does not count', () => {
    const current = node({
      ...users,
      label: 'members',
      position: { x: 500, y: 500 },
      data: {
        ...users.data,
        columns: [col('id', 'id', 'uuid', { primaryKey: true, nullable: false }), col('email', 'email', 'citext'), col('wish', 'wish_count', 'int', { nullable: false })],
        indexes: [{ id: 'ix', columnIds: ['email'], unique: true }, { id: 'ix2', name: 'by_wish', columnIds: ['wish'] }],
      },
    });
    expect(summary(diffNode(users, current))).toEqual([
      'Name: users → members',
      'changed Column email (type)',
      'added Column wish_count',
      'removed Column nickname',
      'changed Index index (unique)',
      'added Index by_wish',
    ]);
    expect(diffNode(users, node({ ...users, position: { x: 9, y: 9 }, size: { width: 300, height: 200 } }))).toEqual([]);
  });

  it('diffs endpoints: route, auth, params by id, responses by status, tags by value', () => {
    const before = node({
      id: 'e',
      type: 'endpoint',
      position: { x: 0, y: 0 },
      data: {
        method: 'GET',
        path: '/orders',
        auth: 'public',
        spec: { tags: ['orders'], params: [{ id: 'p', name: 'page', in: 'query', type: { kind: 'primitive', type: 'integer' } }], responses: [{ status: '200' }, { status: '404' }] },
      },
    });
    const after = node({
      ...before,
      data: {
        method: 'GET',
        path: '/orders',
        auth: 'user',
        spec: {
          tags: ['orders', 'shop'],
          params: [{ id: 'p', name: 'page', in: 'query', required: true, type: { kind: 'primitive', type: 'integer' } }],
          responses: [{ status: '200', description: 'OK' }],
        },
      },
    });
    expect(summary(diffNode(before, after))).toEqual([
      'Auth: public → user',
      'added Tag shop',
      'changed Param query page (required)',
      'changed Response 200 (description)',
      'removed Response 404',
    ]);
  });

  it('diffs wireframe elements by id, ignoring their position, and a wireframe added as a whole', () => {
    const el = (id: string, text: string, x = 0) => ({ id, kind: 'button', text, rect: { x, y: 0, w: 2, h: 4 } });
    const screen = node({ id: 's', type: 'screen', position: { x: 0, y: 0 }, data: { wireframe: { elements: [el('a', 'Save'), el('b', 'Cancel')] } } });
    const moved = node({ ...screen, data: { wireframe: { elements: [el('a', 'Save', 4), el('b', 'Close'), el('c', 'Wish')] } } });
    expect(summary(diffNode(screen, moved))).toEqual(['changed Element Close (text)', 'added Element Wish']);

    const bare = node({ id: 's', type: 'screen', position: { x: 0, y: 0 }, data: {} });
    expect(summary(diffNode(bare, screen))).toEqual(['Wireframe: undefined → [object Object]']);
  });

  it('diffs service methods and job settings; different types give nothing', () => {
    const svc = node({ id: 'x', type: 'service', position: { x: 0, y: 0 }, data: { methods: ['save', 'load'] } });
    expect(summary(diffNode(svc, node({ ...svc, data: { methods: ['save', 'wish'] } })))).toEqual(['added Method wish', 'removed Method load']);
    const job = node({ id: 'j', type: 'job', position: { x: 0, y: 0 }, data: { trigger: 'cron', schedule: '0 * * * *' } });
    expect(summary(diffNode(job, node({ ...job, data: { trigger: 'queue' } })))).toEqual(['Trigger: cron → queue', 'Schedule: 0 * * * * → undefined']);
    expect(diffNode(job, svc)).toEqual([]);
  });
});

describe('diffModel', () => {
  it('lists field and property changes', () => {
    const field = (id: string, name: string, extra: object = {}) => ({ id, name, type: { kind: 'primitive', type: 'string' }, ...extra });
    const before = ApiModel.parse({ id: 'm', name: 'UserDto', fields: [field('a', 'email'), field('b', 'nick')] });
    const after = ApiModel.parse({ id: 'm', name: 'UserDto', description: 'A user', fields: [field('a', 'email', { required: false }), field('c', 'wishCount')] });
    expect(summary(diffModel(before, after))).toEqual([
      'Description: undefined → A user',
      'changed Field email (required)',
      'added Field wishCount',
      'removed Field nick',
    ]);
  });
});

describe('revertEntry', () => {
  it('undoes each entry: props, added, removed (at the old place) and changed items', () => {
    const current = node({
      ...users,
      label: 'members',
      data: {
        ...users.data,
        columns: [col('id', 'id', 'uuid', { primaryKey: true, nullable: false }), col('email', 'email', 'citext'), col('wish', 'wish_count', 'int')],
      },
    });
    let reverted = current;
    for (const entry of diffNode(users, current)) reverted = revertEntry(reverted, users, entry);
    expect(reverted).toEqual(users);

    const [, , added] = diffNode(users, current);
    const once = revertEntry(current, users, added!);
    expect(once.type === 'table' && once.data.columns.map((c) => c.name)).toEqual(['id', 'email']);
  });

  it('keeps an element where it is now when reverting its content', () => {
    const el = (text: string, x: number) => ({ id: 'a', kind: 'button', text, rect: { x, y: 0, w: 2, h: 4 } });
    const before = node({ id: 's', type: 'screen', position: { x: 0, y: 0 }, data: { wireframe: { elements: [el('Save', 0)] } } });
    const after = node({ ...before, data: { wireframe: { elements: [el('Store', 6)] } } });
    const [entry] = diffNode(before, after);
    const reverted = revertEntry(after, before, entry!);
    expect(reverted.type === 'screen' && reverted.data.wireframe?.elements[0]).toMatchObject({ text: 'Save', rect: { x: 6 } });
  });

  it('removes keys set to undefined', () => {
    expect(setPath({ a: { b: 1, c: 2 } }, ['a', 'b'], undefined)).toEqual({ a: { c: 2 } });
  });
});

describe('describeEntry', () => {
  it('writes one readable line per entry', () => {
    const current = node({
      ...users,
      label: 'members',
      data: { ...users.data, columns: [col('id', 'id', 'uuid', { primaryKey: true, nullable: false }), col('email', 'email', 'citext'), col('wish', 'wish_count', 'int')] },
    });
    expect(diffNode(users, current).map(describeEntry)).toEqual([
      'Name: users → members',
      '~ Column email: type text → citext',
      '+ Column wish_count',
      '− Column nickname',
    ]);
    const bare = node({ id: 's', type: 'screen', position: { x: 0, y: 0 }, data: {} });
    const withWf = node({ ...bare, data: { wireframe: { elements: [] } } });
    expect(diffNode(bare, withWf).map(describeEntry)).toEqual(['Wireframe added']);
    expect(diffNode(withWf, bare).map(describeEntry)).toEqual(['Wireframe removed']);
  });
});
