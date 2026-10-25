import type { TableNode } from '@flowcanvas/shared';
import { describe, expect, it } from 'vitest';
import { groupByTag } from '../api-design/ApiPanel';
import type { NodeOf } from '../canvas/mapping';
import { replaceNode, upsertModel } from '../store/docOps';
import { checkoutDoc, shopDoc } from '../test/fixtures';
import { endpointMapper, fromEndpointDraft, newResponseDraft, toEndpointDraft } from './drafts';
import { buildModelDoc, draftFromTable, fromModelDraft, modelMapper, newFieldDraft, newModel, toModelDraft } from './modelDraft';
import { validateDraft } from './validation';

const endpoint = (doc: ReturnType<typeof checkoutDoc>, id: string) => doc.nodes.find((n) => n.id === id) as NodeOf<'endpoint'>;

describe('endpoint draft: params, body, responses', () => {
  it('round-trips a full spec', () => {
    const doc = upsertModel(checkoutDoc(), { id: 'm', name: 'OrderDto', fields: [] });
    const node = endpoint(doc, 'post');
    const draft = toEndpointDraft(node);
    draft.path = '/orders/{orderId}';
    draft.params = [
      { id: 'q', name: 'dryRun', in: 'query', type: { base: 'p:boolean', list: false, format: '', enumValues: '' }, required: false, description: '' },
    ];
    draft.hasBody = true;
    draft.body.type = { base: 'm:m', list: false, format: '', enumValues: '' };
    draft.responses = [{ ...newResponseDraft('201'), hasBody: true, body: { base: 'm:m', list: true, format: '', enumValues: '' } }];

    const spec = fromEndpointDraft(node, draft).data.spec;
    expect(spec.params.map((p) => [p.name, p.in, p.required])).toEqual([
      ['orderId', 'path', true],
      ['dryRun', 'query', false],
    ]);
    expect(spec.requestBody).toEqual({ contentType: 'application/json', type: { kind: 'ref', modelId: 'm' }, required: true });
    expect(spec.responses).toEqual([
      { status: '201', description: '', body: { kind: 'array', items: { kind: 'ref', modelId: 'm' } } },
    ]);
  });

  it('maps param, response and body issues to their fields', () => {
    const doc = checkoutDoc();
    const node = endpoint(doc, 'post');
    const draft = toEndpointDraft(node);
    draft.params = [
      { id: '1', name: 'q', in: 'query', type: { base: 'p:string', list: false, format: '', enumValues: '' }, required: false, description: '' },
      { id: '2', name: 'q', in: 'query', type: { base: 'p:string', list: false, format: '', enumValues: '' }, required: false, description: '' },
    ];
    draft.responses = [newResponseDraft('200'), newResponseDraft('200'), newResponseDraft('2xx')];
    draft.hasBody = true;
    draft.body.type = { base: 'm:gone', list: false, format: '', enumValues: '' };

    const candidate = replaceNode(doc, fromEndpointDraft(node, draft));
    expect(validateDraft(candidate, 'post', endpointMapper).fields).toEqual({
      'responses.2.status': 'Use a status like 200, 4XX or default',
      'params.1.name': 'Duplicate query parameter q',
      'responses.1.status': 'Duplicate response 200',
      'body.type.base': 'Unknown model gone',
    });
  });
});

describe('model draft', () => {
  it('generates fields from a table and keeps the source table', () => {
    const doc = shopDoc();
    const orders = doc.nodes.find((n) => n.id === 'orders') as TableNode;
    const draft = draftFromTable(orders, toModelDraft(newModel()));
    const model = fromModelDraft(newModel(), draft);
    expect(model.name).toBe('OrdersDto');
    expect(model.sourceTableId).toBe('orders');
    expect(model.fields.map((f) => [f.name, f.type])).toEqual([
      ['id', { kind: 'primitive', type: 'string', format: 'uuid', enum: undefined }],
      ['userId', { kind: 'primitive', type: 'string', format: 'uuid', enum: undefined }],
    ]);
  });

  it('reports duplicate model and field names on the edited model', () => {
    const doc = upsertModel(shopDoc(), { id: 'existing', name: 'OrderDto', fields: [] });
    const model = newModel();
    const draft = { ...toModelDraft(model), name: 'OrderDto', fields: [{ ...newFieldDraft(), name: 'id' }, { ...newFieldDraft(), name: 'id' }] };
    const candidate = buildModelDoc(model)(doc, draft);
    expect(validateDraft(candidate, model.id, modelMapper, 'models').fields).toEqual({
      name: 'Duplicate model OrderDto',
      'fields.1.name': 'Duplicate field id',
    });
  });
});

describe('API panel grouping', () => {
  it('groups endpoints by tag, sorted by path, with untagged ones last', () => {
    const doc = checkoutDoc();
    const post = endpoint(doc, 'post');
    const tagged = (id: string, path: string, tags: string[]) => ({
      ...post,
      id,
      data: { ...post.data, path, spec: { ...post.data.spec, tags } },
    });
    const groups = groupByTag([tagged('a', '/b', ['orders']), tagged('b', '/a', ['orders', 'admin']), tagged('c', '/z', [])]);
    expect(groups.map(([tag, list]) => [tag, list.map((e) => e.data.path)])).toEqual([
      ['admin', ['/a']],
      ['orders', ['/a', '/b']],
      ['Other', ['/z']],
    ]);
  });
});
