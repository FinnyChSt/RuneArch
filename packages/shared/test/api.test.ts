import { describe, expect, it } from 'vitest';
import { pathParamNames, syncPathParams, type Param } from '../src';

const param = (name: string, location: Param['in'], extra: Partial<Param> = {}): Param => ({
  id: `${location}-${name}`,
  name,
  in: location,
  type: { kind: 'primitive', type: 'string' },
  required: false,
  ...extra,
});

describe('path params', () => {
  it('reads {params} from a path', () => {
    expect(pathParamNames('/orders/{orderId}/items/{itemId}')).toEqual(['orderId', 'itemId']);
    expect(pathParamNames('/health')).toEqual([]);
  });

  it('adds new path params as required strings, keeps existing ones and other locations', () => {
    const existing = param('orderId', 'path', { type: { kind: 'primitive', type: 'integer' }, required: true });
    const query = param('limit', 'query');
    const synced = syncPathParams('/orders/{orderId}/items/{itemId}', [query, existing]);

    expect(synced.map((p) => [p.name, p.in])).toEqual([
      ['orderId', 'path'],
      ['itemId', 'path'],
      ['limit', 'query'],
    ]);
    expect(synced[0]).toBe(existing);
    expect(synced[1]).toMatchObject({ required: true, type: { kind: 'primitive', type: 'string' } });
  });

  it('drops path params that left the path', () => {
    expect(syncPathParams('/orders', [param('orderId', 'path')])).toEqual([]);
  });
});
