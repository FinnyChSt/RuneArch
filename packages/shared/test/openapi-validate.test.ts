import { validate } from '@readme/openapi-parser';
import { describe, expect, it } from 'vitest';
import { CanvasDoc, emptyCanvas, toOpenApi } from '../src';
import { kitchenSink, str } from './fixtures/kitchen-sink';

/*
 * Phase 5 acceptance: the generated spec passes @readme/openapi-parser.
 */

const check = (spec: object) => validate(structuredClone(spec) as never);

describe('generated OpenAPI passes @readme/openapi-parser', () => {
  it.each(['bearer', 'apiKey', 'none'] as const)('kitchen sink with %s auth', async (auth) => {
    const result = await check(toOpenApi(kitchenSink(auth)));
    expect(result.valid ? [] : result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('an empty canvas', async () => {
    expect((await check(toOpenApi(emptyCanvas()))).valid).toBe(true);
  });
});

describe('the doc rules guard spec validity', () => {
  /** Builds a doc without CanvasDoc's integrity checks, as if the rule were missing */
  const unchecked = (nodes: object[]) => ({ ...emptyCanvas(), nodes }) as unknown as CanvasDoc;
  const endpoint = (id: string, path: string, operationId?: string) => ({
    id,
    type: 'endpoint',
    position: { x: 0, y: 0 },
    data: {
      method: 'GET',
      path,
      auth: 'user',
      spec: { tags: [], operationId, params: [], responses: [{ status: '200', description: 'OK' }], deprecated: false },
    },
  });

  // The parser accepts these, but OpenAPI forbids them: "Templated paths with the same hierarchy but
  // different templated names MUST NOT exist as they are identical" (and code generators break on them)
  it('routes differing only in param names: rejected doc', () => {
    const withParam = (id: string, name: string) => {
      const e = endpoint(id, `/orders/{${name}}`);
      e.data.spec = { ...e.data.spec, params: [{ id: name, name, in: 'path', type: str, required: true }] } as never;
      return e;
    };
    const nodes = [withParam('a', 'id'), withParam('b', 'orderId')];
    expect(CanvasDoc.safeParse(unchecked(nodes)).success).toBe(false);
  });

  it('duplicate operationIds: invalid spec, rejected doc', async () => {
    const nodes = [endpoint('a', '/a', 'list'), endpoint('b', '/b', 'list')];
    expect((await check(toOpenApi(unchecked(nodes)))).valid).toBe(false);
    expect(CanvasDoc.safeParse(unchecked(nodes)).success).toBe(false);
  });
});
