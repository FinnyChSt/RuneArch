// @vitest-environment jsdom
import { emptyCanvas, toCanvasJson, type CanvasDoc } from '@flowcanvas/shared';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DialogHost } from '../dialogs/DialogHost';
import { undo, useCanvasStore } from '../store/canvasStore';
import { useUiStore } from '../store/uiStore';
import { checkoutDoc, shopDoc } from '../test/fixtures';

const store = () => useCanvasStore.getState();
const tableLabels = () => store().doc.nodes.flatMap((n) => (n.type === 'table' ? [n.label] : []));
const history = () => useCanvasStore.temporal.getState().pastStates.length;

beforeEach(() => {
  store().load(shopDoc(), 1, 'p1');
  useUiStore.setState({ dialog: null, selection: [] });
  render(<DialogHost />);
});
afterEach(cleanup);

async function openImport() {
  act(() => useUiStore.getState().openDialog({ kind: 'import' }));
  return screen.findByRole('radiogroup', { name: 'Format' });
}

/** Pastes (sets) text without typing it key by key */
const paste = (label: RegExp, text: string) => fireEvent.change(screen.getByLabelText(label), { target: { value: text } });

describe('import dialog', () => {
  it('previews SQL, then adds and updates tables in one undo step', async () => {
    await openImport();
    paste(/SQL to import/, 'CREATE TABLE users (id uuid PRIMARY KEY, email text, name text); CREATE TABLE tags (id int PRIMARY KEY);');
    const preview = screen.getByRole('region', { name: 'Preview' });
    await waitFor(() => expect(preview.textContent).toContain('1 new, 1 updated table, 0 new foreign keys'));
    const before = history();
    await userEvent.click(screen.getByRole('button', { name: 'Import 2 tables' }));
    await waitFor(() => expect(useUiStore.getState().dialog).toBeNull());
    expect(history()).toBe(before + 1);
    expect(tableLabels()).toEqual(['users', 'orders', 'tags']);
    const users = store().doc.nodes.find((n) => n.id === 'users');
    expect(users?.type === 'table' && users.data.columns.map((c) => c.name)).toEqual(['id', 'email', 'name']);
    expect(useUiStore.getState().selection).toHaveLength(2);
    undo();
    expect(tableLabels()).toEqual(['users', 'orders']);
  });

  it('reads DBML and shows parser warnings', async () => {
    const user = userEvent.setup();
    await openImport();
    await user.click(screen.getByRole('radio', { name: 'DBML' }));
    paste(/DBML to import/, 'Table a {\n  id int [pk]\n}\nTable b {\n  id int [pk]\n}\nRef: a.id <> b.id');
    await waitFor(() => expect(screen.getByRole('region', { name: 'Preview' }).textContent).toContain('many-to-many'));
    expect(screen.getByRole('button', { name: 'Import 2 tables' })).toHaveProperty('disabled', false);
  });

  it('replaces the canvas with a JSON file, or explains why it cannot', async () => {
    const user = userEvent.setup();
    await openImport();
    await user.click(screen.getByRole('radio', { name: 'JSON' }));
    paste(/JSON to import/, '{"nodes": 3}');
    await waitFor(() => expect(screen.getByText('The file is not a valid RuneArch document')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Replace canvas' })).toHaveProperty('disabled', true);

    const file: CanvasDoc = { ...checkoutDoc(), viewport: emptyCanvas().viewport };
    paste(/JSON to import/, toCanvasJson(file));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Replace canvas' })).toHaveProperty('disabled', false));
    await user.click(screen.getByRole('button', { name: 'Replace canvas' }));
    expect(store().doc.nodes.map((n) => n.id)).toEqual(file.nodes.map((n) => n.id));
    undo();
    expect(tableLabels()).toEqual(['users', 'orders']);
  });

  it('opens a file and picks the format from its extension', async () => {
    await openImport();
    const input = screen.getByLabelText('Import file') as HTMLInputElement;
    const file = new File(['Table notes {\n  id int [pk]\n}'], 'model.dbml', { type: 'text/plain' });
    await userEvent.upload(input, file);
    await waitFor(() => expect(screen.getByRole('radio', { name: 'DBML' }).getAttribute('aria-checked')).toBe('true'));
    expect((screen.getByLabelText(/DBML to import/) as HTMLTextAreaElement).value).toContain('Table notes');
  });

  describe('OpenAPI', () => {
    const spec = `openapi: 3.0.3
info: { title: Orders API, version: "2.0" }
paths:
  /orders:
    get:
      responses: { "200": { description: "" } }
    post:
      summary: Create an order
      parameters: [{ name: session, in: cookie, schema: { type: string } }]
      responses: { "201": { description: Created, content: { application/json: { schema: { $ref: "#/components/schemas/OrderDto" } } } } }
  /orders/{id}:
    get:
      tags: [orders]
      parameters: [{ name: id, in: path, required: true, schema: { type: string } }]
      responses: { "200": { description: "" } }
components:
  schemas:
    OrderDto: { type: object, properties: { id: { type: string } } }
`;
    const endpointRoutes = () => store().doc.nodes.flatMap((n) => (n.type === 'endpoint' ? [`${n.data.method} ${n.data.path}`] : []));

    it('previews the merge, then imports it in one undo step', async () => {
      const user = userEvent.setup();
      await openImport();
      await user.click(screen.getByRole('radio', { name: 'OpenAPI' }));
      paste(/OpenAPI to import/, spec);
      const preview = screen.getByRole('region', { name: 'Preview' });
      await waitFor(() => expect(preview.textContent).toContain('Endpoints: 1 new, 1 updated, 1 unchanged'));
      expect(preview.textContent).toContain('Models: 1 new, 0 updated, 0 unchanged');
      // Warnings are grouped by kind
      expect(screen.getByRole('region', { name: 'Warnings' }).textContent).toContain('Skipped · 1');
      // The canvas already has endpoints, so its API settings stay unless asked
      expect(screen.getByRole('checkbox', { name: /Use the spec's title/ })).toHaveProperty('checked', false);

      const before = history();
      await user.click(screen.getByRole('button', { name: 'Import 2 endpoints' }));
      await waitFor(() => expect(useUiStore.getState().dialog).toBeNull());
      expect(history()).toBe(before + 1);
      expect(endpointRoutes()).toEqual(['GET /orders', 'POST /orders', 'GET /orders/{id}']);
      const post = store().doc.nodes.find((n) => n.id === 'post');
      expect(post?.type === 'endpoint' && post.data.spec.summary).toBe('Create an order');
      expect(store().doc.api.title).not.toBe('Orders API');
      expect(useUiStore.getState().selection).toHaveLength(2);
      undo();
      expect(endpointRoutes()).toEqual(['GET /orders', 'POST /orders']);
    });

    it('says when the canvas is already up to date', async () => {
      const user = userEvent.setup();
      await openImport();
      await user.click(screen.getByRole('radio', { name: 'OpenAPI' }));
      paste(/OpenAPI to import/, spec);
      await user.click(await screen.findByRole('button', { name: 'Import 2 endpoints' }));
      act(() => useUiStore.getState().openDialog({ kind: 'import' }));
      await user.click(await screen.findByRole('radio', { name: 'OpenAPI' }));
      paste(/OpenAPI to import/, spec);
      expect(await screen.findByRole('button', { name: 'Up to date' })).toHaveProperty('disabled', true);
    });

    it('takes the spec settings on an empty canvas and rejects Swagger 2.0', async () => {
      store().load(emptyCanvas(), 1, 'p1');
      const user = userEvent.setup();
      await openImport();
      await user.click(screen.getByRole('radio', { name: 'OpenAPI' }));
      paste(/OpenAPI to import/, 'swagger: "2.0"\ninfo: { title: Old }');
      await waitFor(() => expect(screen.getByRole('region', { name: 'Preview' }).textContent).toMatch(/Swagger 2\.0 is not supported/));
      expect(screen.getByRole('button', { name: 'Import' })).toHaveProperty('disabled', true);

      paste(/OpenAPI to import/, spec);
      expect(await screen.findByRole('checkbox', { name: /Use the spec's title/ })).toHaveProperty('checked', true);
      await user.click(screen.getByRole('button', { name: 'Import 3 endpoints' }));
      expect(store().doc.api).toMatchObject({ title: 'Orders API', version: '2.0', auth: 'none' });
      expect(store().doc.nodes.filter((n) => n.type === 'frame').map((f) => f.label)).toEqual(['orders']);
    });

    it.each([
      ['api.yaml', spec],
      ['api.json', JSON.stringify({ openapi: '3.1.0', info: { title: 'x', version: '1' }, paths: {} })],
    ])('detects OpenAPI from %s', async (name, content) => {
      await openImport();
      await userEvent.upload(screen.getByLabelText('Import file') as HTMLInputElement, new File([content], name));
      await waitFor(() => expect(screen.getByRole('radio', { name: 'OpenAPI' }).getAttribute('aria-checked')).toBe('true'));
    });

    it('keeps a RuneArch .json file as JSON', async () => {
      await openImport();
      await userEvent.upload(screen.getByLabelText('Import file') as HTMLInputElement, new File([toCanvasJson(shopDoc())], 'canvas.json'));
      await waitFor(() => expect(screen.getByRole('radio', { name: 'JSON' }).getAttribute('aria-checked')).toBe('true'));
    });
  });
});
