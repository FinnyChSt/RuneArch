import { Parser } from '@dbml/core';
import { validate } from '@readme/openapi-parser';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  applyScope,
  beforeFeature,
  CanvasDoc,
  canvasToSvg,
  emptyCanvas,
  featureAnnotations,
  featureBrief,
  featureBriefMarkdown,
  featureDependencies,
  featureExportByFile,
  FEATURE_EXPORTS,
  featureTasks,
  scopeToFeature,
  toDbml,
  toFeatureOpenApi,
  toMermaidEr,
  toMermaidFlowchart,
  toSqlSchema,
  withoutUnshipped,
} from '../src';

const pos = { x: 0, y: 0 };
const col = (id: string, name: string, type: string, extra: object = {}) => ({ id, name, type, ...extra });
const usersBase = {
  id: 'users',
  type: 'table',
  label: 'users',
  position: pos,
  data: { columns: [col('u_id', 'id', 'integer', { primaryKey: true, nullable: false }), col('u_nick', 'nickname', 'text')] },
};

/**
 * Wishlist (in progress, teal) changes users and the Product screen, adds wishlist_items, POST
 * /wishlist and WishDto, removes GET /favorites, uses products. Profiles (draft) adds a bio table
 * that Wishlist reads. Orders (shipped) added orders. Notes is unrelated.
 */
function doc() {
  return CanvasDoc.parse({
    ...emptyCanvas(),
    database: { dialect: 'sqlite' },
    nodes: [
      { id: 'lane', type: 'frame', label: 'Data', position: { x: 500, y: 0 }, size: { width: 600, height: 400 }, data: {} },
      {
        ...usersBase,
        data: { columns: [col('u_id', 'id', 'integer', { primaryKey: true, nullable: false }), col('u_wish', 'wish_count', 'integer', { nullable: false, default: '0' })] },
      },
      { id: 'products', type: 'table', label: 'products', position: pos, data: { columns: [col('p_id', 'id', 'integer', { primaryKey: true, nullable: false })] } },
      {
        id: 'wish',
        type: 'table',
        label: 'wishlist_items',
        parentId: 'lane',
        position: { x: 20, y: 40 },
        data: { columns: [col('w_id', 'id', 'integer', { primaryKey: true, nullable: false }), col('w_user', 'user_id', 'integer'), col('w_prod', 'product_id', 'integer')] },
      },
      { id: 'bio', type: 'table', label: 'bios', position: pos, data: { columns: [col('b_id', 'id', 'integer', { primaryKey: true, nullable: false })] } },
      { id: 'orders', type: 'table', label: 'orders', position: pos, data: { columns: [col('o_id', 'id', 'integer', { primaryKey: true, nullable: false })] } },
      { id: 'notes', type: 'table', label: 'notes', position: pos, data: {} },
      {
        id: 'post',
        type: 'endpoint',
        position: pos,
        data: { method: 'POST', path: '/wishlist', spec: { requestBody: { type: { kind: 'ref', modelId: 'dto' } }, responses: [{ status: '201', body: { kind: 'ref', modelId: 'dto' } }] } },
      },
      { id: 'fav', type: 'endpoint', position: pos, data: { method: 'GET', path: '/favorites' } },
      { id: 'getp', type: 'endpoint', position: pos, data: { method: 'GET', path: '/products' } },
      { id: 'prod', type: 'screen', label: 'Product', position: pos, data: { wireframe: { elements: [{ id: 'w', kind: 'button', text: 'Wish', rect: { x: 0, y: 0, w: 3, h: 4 } }] } } },
    ],
    edges: [
      { id: 'fk_wu', kind: 'fk', source: 'wish', target: 'users', data: { sourceColumnId: 'w_user', targetColumnId: 'u_id' } },
      { id: 'fk_wp', kind: 'fk', source: 'wish', target: 'products', data: { sourceColumnId: 'w_prod', targetColumnId: 'p_id' } },
      { id: 'click', kind: 'calls', source: 'prod', target: 'post', sourceHandle: 'el:w' },
      { id: 'write', kind: 'writes', source: 'post', target: 'wish', crud: ['create'] },
      { id: 'readbio', kind: 'reads', source: 'post', target: 'bio' },
      { id: 'list', kind: 'reads', source: 'getp', target: 'products' },
    ],
    flows: [{ id: 'fl', name: 'Wish', steps: [{ edgeId: 'click' }, { edgeId: 'write' }] }],
    models: [
      { id: 'dto', name: 'WishDto', fields: [{ id: 'f', name: 'productId', type: { kind: 'primitive', type: 'integer' } }] },
      { id: 'other', name: 'OtherDto', fields: [] },
    ],
    features: [
      {
        id: 'f',
        name: 'Wishlist',
        color: 'teal',
        status: 'in-progress',
        acceptance: ['A user can save a product'],
        flowIds: ['fl'],
        items: [
          { ref: { kind: 'node', id: 'users' }, role: 'changed', note: 'counts wishes' },
          { ref: { kind: 'node', id: 'wish' }, role: 'added' },
          { ref: { kind: 'node', id: 'post' }, role: 'added' },
          { ref: { kind: 'node', id: 'fav' }, role: 'removed' },
          { ref: { kind: 'node', id: 'prod' }, role: 'uses' },
          { ref: { kind: 'node', id: 'bio' }, role: 'uses' },
          { ref: { kind: 'model', id: 'dto' }, role: 'added' },
          { ref: { kind: 'edge', id: 'fk_wu' }, role: 'added' },
          { ref: { kind: 'edge', id: 'click' }, role: 'added', progress: 'done' },
          { ref: { kind: 'edge', id: 'write' }, role: 'added' },
        ],
        baseline: { nodes: { users: usersBase } },
      },
      { id: 'p', name: 'Profiles', items: [{ ref: { kind: 'node', id: 'bio' }, role: 'added' }] },
      { id: 's', name: 'Orders', status: 'shipped', items: [{ ref: { kind: 'node', id: 'orders' }, role: 'added' }] },
    ],
  });
}

describe('scopeToFeature', () => {
  it('keeps the items and the context they need, as a valid doc', () => {
    const scoped = scopeToFeature(doc(), 'f')!;
    expect(scoped.doc.nodes.map((n) => n.id).sort()).toEqual(['bio', 'fav', 'lane', 'post', 'prod', 'products', 'users', 'wish']);
    expect(scoped.doc.edges.map((e) => e.id).sort()).toEqual(['click', 'fk_wp', 'fk_wu', 'readbio', 'write']);
    expect(scoped.doc.models.map((m) => m.name)).toEqual(['WishDto']);
    expect(scoped.doc.flows.map((f) => f.steps.length)).toEqual([2]);
    expect(scoped.roles!.get('node:products')).toBe('uses');
    expect(scoped.roles!.get('node:lane')).toBeUndefined();
    expect(() => CanvasDoc.parse(scoped.doc)).not.toThrow();
    expect(applyScope(doc(), { featureId: 'nope' })).toBeNull();
  });
});

describe('withoutUnshipped and beforeFeature', () => {
  it('drops what unshipped features add, keeps shipped work and models still in use', () => {
    const d = withoutUnshipped(doc());
    expect(d.nodes.map((n) => n.id)).not.toContain('wish');
    expect(d.nodes.map((n) => n.id)).not.toContain('bio');
    expect(d.nodes.map((n) => n.id)).toContain('orders');
    expect(d.edges.map((e) => e.id).sort()).toEqual(['list']);
    expect(d.models.map((m) => m.name)).toEqual(['OtherDto']);
    expect(() => CanvasDoc.parse(d)).not.toThrow();
    expect(applyScope(doc(), { unshipped: 'exclude' })!.doc).toEqual(d);
    expect(applyScope(doc())!.doc).toEqual(doc());
  });

  it('gives the project as it was before a feature', () => {
    const d = beforeFeature(doc(), 'f')!;
    const users = d.nodes.find((n) => n.id === 'users');
    expect(users?.type === 'table' && users.data.columns.map((c) => c.name)).toEqual(['id', 'nickname']);
    expect(d.nodes.map((n) => n.id)).not.toContain('wish');
    expect(d.nodes.map((n) => n.id)).toContain('fav');
    expect(() => CanvasDoc.parse(d)).not.toThrow();
  });

  it('finds the unshipped features a feature depends on', () => {
    expect(featureDependencies(doc(), 'f')).toEqual([{ featureId: 'p', name: 'Profiles', items: [{ kind: 'node', id: 'bio' }] }]);
    expect(featureDependencies(doc(), 'p')).toEqual([]);
  });
});

describe('schema exports for a feature', () => {
  const scoped = () => scopeToFeature(doc(), 'f')!.doc;
  const feature = () => featureAnnotations(doc(), 'f')!;

  it('groups DBML tables by role with notes, and stays valid DBML', () => {
    const dbml = toDbml(scoped(), { feature: feature() });
    expect(dbml).toContain('TableGroup "New in Wishlist" {\n  wishlist_items\n}');
    expect(dbml).toContain('TableGroup "Changed by Wishlist" {\n  users\n}');
    expect(dbml).toContain('TableGroup Existing {\n  products\n  bios\n}');
    expect(dbml).toContain("wish_count integer [not null, default: 0, note: 'Wishlist: new']");
    expect(dbml).toContain("Note: 'changed by Wishlist; drops nickname'");
    expect(dbml).not.toContain('TableGroup Data');
    const tables = new Parser().parse(dbml, 'dbml').export().schemas.flatMap((s) => s.tables.map((t) => t.name));
    expect(tables.sort()).toEqual(['bios', 'products', 'users', 'wishlist_items']);
  });

  it('comments Mermaid ER and SQL, and the SQL still runs', () => {
    const mmd = toMermaidEr(scoped(), { feature: feature() });
    expect(mmd).toContain('%% users: changed by Wishlist; drops nickname');
    expect(mmd).toContain('integer wish_count "not null; default: 0; Wishlist: new"');
    const sql = toSqlSchema(scoped(), { feature: feature() });
    expect(sql).toContain('-- wishlist_items: new in Wishlist\nCREATE TABLE wishlist_items (');
    expect(sql).toContain('wish_count integer NOT NULL DEFAULT 0 -- Wishlist: new');
    expect(() => new DatabaseSync(':memory:').exec(sql)).not.toThrow();
  });
});

describe('toFeatureOpenApi', () => {
  it('marks operations and schemas, deprecates removed ones, and is a valid spec', async () => {
    const spec = toFeatureOpenApi(doc(), 'f')! as { paths: Record<string, Record<string, Record<string, unknown>>>; components: { schemas: Record<string, Record<string, unknown>> }; info: Record<string, unknown> };
    expect(spec.info['x-feature']).toBe('Wishlist');
    expect(spec.paths['/wishlist']!.post!['x-feature-status']).toBe('new');
    expect(spec.paths['/favorites']!.get).toMatchObject({ 'x-feature-status': 'removed', deprecated: true });
    expect(spec.components.schemas.WishDto!['x-feature-status']).toBe('new');
    const result = await validate(structuredClone(spec) as never);
    expect(result.valid ? [] : result.errors).toEqual([]);
    expect(toFeatureOpenApi(doc(), 'nope')).toBeNull();
  });

  it('leaves existing endpoints out with onlyChanges', () => {
    const d = CanvasDoc.parse({ ...doc(), features: [{ ...doc().features[0]!, items: [...doc().features[0]!.items, { ref: { kind: 'node', id: 'getp' }, role: 'uses' }] }] });
    expect(Object.keys((toFeatureOpenApi(d, 'f') as { paths: object }).paths).sort()).toEqual(['/favorites', '/products', '/wishlist']);
    expect(Object.keys((toFeatureOpenApi(d, 'f', { onlyChanges: true }) as { paths: object }).paths).sort()).toEqual(['/favorites', '/wishlist']);
  });
});

describe('canvas exports for a feature', () => {
  const roles = () => scopeToFeature(doc(), 'f')!.roles!;
  it('badges cards in the SVG and titles it with the feature', () => {
    const svg = canvasToSvg(scopeToFeature(doc(), 'f')!.doc, { feature: { name: 'Wishlist', color: 'teal', roles: roles() } });
    for (const text of ['Feature: Wishlist', '>NEW<', '>CHANGED<', '>EXISTING<', '>REMOVED<', 'arrow-feature']) expect(svg).toContain(text);
  });

  it('tags Mermaid flowchart nodes and colors the feature edges', () => {
    const mmd = toMermaidFlowchart(scopeToFeature(doc(), 'f')!.doc, { feature: { name: 'Wishlist', color: 'teal', roles: roles() } });
    expect(mmd).toContain('%% Generated by RuneArch. Feature: Wishlist');
    expect(mmd).toMatch(/\[\/"POST \/wishlist<br\/><small>NEW<\/small>"\/\]/);
    expect(mmd).toMatch(/classDef featureNew stroke:#4FB3A6/);
    expect(mmd).toMatch(/class [n\d,]+ featureRemoved/);
    expect(mmd).toMatch(/linkStyle [\d,]+ stroke:#4FB3A6/);
  });
});

describe('brief, tasks and the registry', () => {
  it('groups everything the feature touches by role', () => {
    const brief = featureBrief(doc(), 'f')!;
    expect(brief.tables.new.map((t) => t.name)).toEqual(['wishlist_items']);
    expect(brief.tables.changed).toEqual([expect.objectContaining({ name: 'users', note: 'counts wishes', changes: ['+ Column wish_count', '− Column nickname'] })]);
    expect(brief.tables.existing.map((t) => t.name)).toEqual(['products', 'bios']);
    expect(brief.endpoints.removed.map((e) => e.name)).toEqual(['GET /favorites']);
    expect(brief.flows).toEqual([{ name: 'Wish', steps: ['Product · Wish → POST /wishlist · calls', 'POST /wishlist → wishlist_items · writes: create'] }]);
    expect(brief.dependsOn).toEqual([{ feature: 'Profiles', items: ['bios'] }]);
    expect(brief.api).toEqual({ bump: 'major', from: '0.1.0', to: '1.0.0' });
  });

  it('renders the brief as Markdown with DDL and the migration', () => {
    const md = featureBriefMarkdown(doc(), 'f')!;
    for (const heading of ['# Feature: Wishlist', '## Acceptance criteria', '## Depends on', '## Flows', '## Database', '### Existing (used as is)', '## API endpoints', '## Warnings', '## Database migration'])
      expect(md).toContain(heading);
    expect(md).toContain('- [ ] A user can save a product');
    expect(md).toContain('CREATE TABLE wishlist_items (');
  });

  it('lists tasks per lane, with progress', () => {
    expect(featureTasks(doc(), 'f')!.map((t) => `${t.lane}: ${t.done ? '[x] ' : ''}${t.text}`)).toEqual([
      'Database: Add column `wish_count` to table `users` — counts wishes',
      'Database: Drop column `nickname` from table `users`',
      'Database: Create table `wishlist_items`',
      'Backend: Add endpoint `POST /wishlist`',
      'Backend: Remove endpoint `GET /favorites`',
      'Backend: Add model `WishDto`',
      'Database: Add foreign key: wishlist_items.user_id → users.id (foreign key)',
      'Frontend: [x] Connect: Product · Wish → POST /wishlist · calls',
      'Backend: Connect: POST /wishlist → wishlist_items · writes: create',
    ]);
  });

  it('finds every export by file name and renders null for unknown features', () => {
    for (const format of Object.values(FEATURE_EXPORTS)) {
      expect(featureExportByFile(format.file)).toBe(format);
      expect(format.render(doc(), 'f')).toEqual(expect.any(String));
      expect(format.render(doc(), 'nope')).toBeNull();
    }
    expect(JSON.parse(FEATURE_EXPORTS.briefJson.render(doc(), 'f')!).feature.name).toBe('Wishlist');
    expect(featureExportByFile('nope.txt')).toBeUndefined();
  });
});
