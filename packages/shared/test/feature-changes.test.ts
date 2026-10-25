import { describe, expect, it } from 'vitest';
import { bumpVersion, CanvasDoc, emptyCanvas, featureChanges, type FeatureWarning } from '../src';

const pos = { x: 0, y: 0 };
const col = (id: string, name: string, extra: object = {}) => ({ id, name, type: 'text', ...extra });
const field = (id: string, name: string, extra: object = {}) => ({ id, name, type: { kind: 'primitive', type: 'string' }, ...extra });

const usersBase = { id: 'users', type: 'table', label: 'users', position: pos, data: { columns: [col('id', 'id', { primaryKey: true, nullable: false })] } };
const getBase = { id: 'get', type: 'endpoint', position: pos, data: { method: 'GET', path: '/users', auth: 'public' } };
const dtoBase = { id: 'm', name: 'UserDto', fields: [field('a', 'email'), field('b', 'nick')] };

/** A feature that changes users, GET /users and UserDto, adds a table and an endpoint, removes one */
function doc(overrides: { features?: unknown[]; version?: string; nodes?: unknown[]; edges?: unknown[]; flows?: unknown[] } = {}) {
  return CanvasDoc.parse({
    ...emptyCanvas(),
    api: { ...emptyCanvas().api, version: overrides.version ?? '1.4.2' },
    nodes: overrides.nodes ?? [
      {
        ...usersBase,
        data: { columns: [...usersBase.data.columns, col('wish', 'wish_count', { nullable: false }), col('bio', 'bio', { nullable: false, default: "''" })] },
      },
      { ...getBase, data: { ...getBase.data, auth: 'user' } },
      { id: 'wish', type: 'table', label: 'wishlist_items', position: pos, data: {} },
      { id: 'post', type: 'endpoint', position: pos, data: { method: 'POST', path: '/wishlist', spec: { requestBody: { type: { kind: 'ref', modelId: 'm' } } } } },
      { id: 'fav', type: 'endpoint', position: pos, data: { method: 'GET', path: '/favorites' } },
      { id: 'cart', type: 'screen', label: 'Cart', position: pos, data: {} },
    ],
    edges: overrides.edges ?? [{ id: 'c', kind: 'calls', source: 'cart', target: 'get' }],
    flows: overrides.flows ?? [{ id: 'flow', name: 'Browse', steps: [{ edgeId: 'c' }] }],
    models: [{ ...dtoBase, fields: [field('a', 'email'), field('c', 'wishCount')] }],
    features: overrides.features ?? [
      {
        id: 'f',
        name: 'Wishlist',
        items: [
          { ref: { kind: 'node', id: 'users' }, role: 'changed', note: 'counts wishes' },
          { ref: { kind: 'node', id: 'get' }, role: 'changed' },
          { ref: { kind: 'model', id: 'm' }, role: 'changed' },
          { ref: { kind: 'node', id: 'wish' }, role: 'added' },
          { ref: { kind: 'node', id: 'post' }, role: 'added' },
          { ref: { kind: 'node', id: 'fav' }, role: 'removed' },
        ],
        baseline: { nodes: { users: usersBase, get: getBase }, models: { m: dtoBase } },
        flowIds: ['flow'],
      },
    ],
  });
}

const byCode = (warnings: FeatureWarning[], code: FeatureWarning['code']) => warnings.filter((w) => w.code === code).map((w) => w.message);

describe('featureChanges', () => {
  it('lists every item with its role, note and diff entries', () => {
    const changes = featureChanges(doc(), 'f')!;
    expect(changes.items.map((i) => [i.ref.id, i.role, i.entries.length])).toEqual([
      ['users', 'changed', 2],
      ['get', 'changed', 1],
      ['m', 'changed', 2],
      ['wish', 'added', 0],
      ['post', 'added', 0],
      ['fav', 'removed', 0],
    ]);
    expect(changes.items[0]!.note).toBe('counts wishes');
    expect(featureChanges(doc(), 'nope')).toBeNull();
  });

  it('warns about backfills, breaking changes and unused new parts', () => {
    const { warnings } = featureChanges(doc(), 'f')!;
    expect(byCode(warnings, 'backfill')).toEqual(['users.wish_count is NOT NULL without a default: existing rows need a backfill']);
    expect(byCode(warnings, 'breaking')).toEqual([
      'GET /users: auth tightened from public to user',
      'UserDto.wishCount is a new required field in requests',
      'UserDto.nick removed',
      'GET /favorites is removed',
    ]);
    expect(byCode(warnings, 'unused-table')).toEqual(['wishlist_items is not read or written by anything']);
    expect(byCode(warnings, 'uncalled-endpoint')).toEqual(['POST /wishlist is not called by any screen, service or flow']);
    expect(warnings.find((w) => w.code === 'outside-flow')).toEqual({
      code: 'outside-flow',
      message: 'Flow Browse passes through Cart, which is not in the feature',
      ref: { kind: 'node', id: 'cart' },
    });
  });

  it('suggests the API version bump: major for breaking, minor for additions, patch otherwise', () => {
    expect(featureChanges(doc(), 'f')).toMatchObject({ apiBump: 'major', nextApiVersion: '2.0.0' });

    const onlyAdds = doc({ features: [{ id: 'f', name: 'A', items: [{ ref: { kind: 'node', id: 'post' }, role: 'added' }] }] });
    expect(featureChanges(onlyAdds, 'f')).toMatchObject({ apiBump: 'minor', nextApiVersion: '1.5.0' });

    const described = doc({
      nodes: [{ ...getBase, data: { ...getBase.data, spec: { summary: 'List users' } } }],
      edges: [],
      flows: [],
      features: [{ id: 'f', name: 'A', items: [{ ref: { kind: 'node', id: 'get' }, role: 'changed' }], baseline: { nodes: { get: getBase } } }],
    });
    expect(featureChanges(described, 'f')).toMatchObject({ apiBump: 'patch', nextApiVersion: '1.4.3' });

    const tablesOnly = doc({ features: [{ id: 'f', name: 'A', items: [{ ref: { kind: 'node', id: 'wish' }, role: 'added' }] }] });
    expect(featureChanges(tablesOnly, 'f')!.apiBump).toBeNull();
    expect(featureChanges(doc({ version: 'beta' }), 'f')!.nextApiVersion).toBeUndefined();
  });

  it('lists the element links a feature adds to a screen', () => {
    const screen = { id: 's', type: 'screen', position: pos, data: { wireframe: { elements: [{ id: 'b', kind: 'button', text: 'Wish', rect: { x: 0, y: 0, w: 2, h: 4 } }] } } };
    const d = doc({
      nodes: [screen, { ...getBase }],
      edges: [{ id: 'l', kind: 'calls', source: 's', target: 'get', sourceHandle: 'el:b' }],
      flows: [],
      features: [{ id: 'f', name: 'A', items: [{ ref: { kind: 'node', id: 's' }, role: 'uses' }, { ref: { kind: 'edge', id: 'l' }, role: 'added' }] }],
    });
    expect(featureChanges(d, 'f')!.items[0]!.addedLinks).toEqual(['l']);
  });

  it('warns when two features change an item from different originals', () => {
    const d = doc({
      features: [
        { id: 'f', name: 'Wishlist', items: [{ ref: { kind: 'node', id: 'users' }, role: 'changed' }], baseline: { nodes: { users: usersBase } } },
        {
          id: 'g',
          name: 'Profiles',
          items: [{ ref: { kind: 'node', id: 'users' }, role: 'changed' }],
          baseline: { nodes: { users: { ...usersBase, label: 'people' } } },
        },
      ],
    });
    expect(byCode(featureChanges(d, 'f')!.warnings, 'drift')).toEqual(['Profiles changes users too, starting from a different version']);
  });
});

describe('bumpVersion', () => {
  it('bumps x.y.z and gives up on anything else', () => {
    expect(bumpVersion('0.1.0', 'major')).toBe('1.0.0');
    expect(bumpVersion('0.1.9', 'minor')).toBe('0.2.0');
    expect(bumpVersion(' 2.3.4 ', 'patch')).toBe('2.3.5');
    expect(bumpVersion('v1', 'patch')).toBeUndefined();
  });
});
