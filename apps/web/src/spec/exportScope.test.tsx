// @vitest-environment jsdom
import { CanvasDoc } from '@flowcanvas/shared';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DialogHost } from '../dialogs/DialogHost';
import { useCanvasStore } from '../store/canvasStore';
import { useUiStore } from '../store/uiStore';
import { shopDoc } from '../test/fixtures';

/** shopDoc where the Orders feature (draft) adds orders and POST /orders, changes users (email is new) and uses GET /orders */
function featureDoc() {
  const doc = shopDoc();
  const users = doc.nodes.find((n) => n.id === 'users')!;
  const usersBase = users.type === 'table' ? { ...users, data: { ...users.data, columns: users.data.columns.slice(0, 1) } } : users;
  return CanvasDoc.parse({
    ...doc,
    features: [
      {
        id: 'f',
        name: 'Orders',
        items: [
          { ref: { kind: 'node', id: 'orders' }, role: 'added' },
          { ref: { kind: 'node', id: 'post' }, role: 'added' },
          { ref: { kind: 'node', id: 'users' }, role: 'changed' },
          { ref: { kind: 'node', id: 'get' }, role: 'uses' },
          { ref: { kind: 'edge', id: 'fk' }, role: 'added' },
          { ref: { kind: 'edge', id: 'w' }, role: 'added' },
        ],
        baseline: { nodes: { users: usersBase } },
      },
    ],
  });
}

const liveUrl = () => screen.getByRole('button', { name: /Copy live URL/ }).getAttribute('title') ?? '';

beforeEach(() => {
  useCanvasStore.getState().load(featureDoc(), 1, 'p1');
  useUiStore.setState({ dialog: null, selection: [], viewFeatureId: null, activeFlowId: null });
  render(<DialogHost />);
});

afterEach(cleanup);

describe('export scope in the project dialogs', () => {
  it('schema: a feature groups tables by role; the whole project can leave out unshipped additions', async () => {
    const user = userEvent.setup();
    act(() => useUiStore.getState().openDialog({ kind: 'schema' }));
    const code = () => screen.getByLabelText('Database schema (DBML)').textContent ?? '';
    expect(await screen.findByLabelText('Database schema (DBML)')).toBeTruthy();
    expect(code()).toContain('Table orders {');

    await user.click(screen.getByLabelText('Leave out unshipped additions'));
    await waitFor(() => expect(code()).not.toContain('Table orders {'));
    expect(liveUrl()).toMatch(/schema\.dbml\?unshipped=exclude$/);

    await user.selectOptions(screen.getByLabelText('Scope'), 'f');
    await waitFor(() => expect(code()).toContain('TableGroup "New in Orders"'));
    expect(code()).toContain("note: 'Orders: new'");
    expect(screen.queryByLabelText('Leave out unshipped additions')).toBeNull();
    expect(liveUrl()).toMatch(/schema\.dbml\?feature=f$/);
  });

  it('starts at the highlighted feature', async () => {
    act(() => {
      useUiStore.setState({ viewFeatureId: 'f' });
      useUiStore.getState().openDialog({ kind: 'export' });
    });
    expect(((await screen.findByLabelText('Scope')) as HTMLSelectElement).value).toBe('f');
  });

  it('API spec: marks the feature and can show only its changes', async () => {
    const user = userEvent.setup();
    act(() => useUiStore.getState().openDialog({ kind: 'spec' }));
    const code = () => screen.getByLabelText('OpenAPI spec (YAML)').textContent ?? '';
    await screen.findByLabelText('OpenAPI spec (YAML)');
    expect(code()).toContain('/orders:');
    await user.selectOptions(screen.getByLabelText('Scope'), 'f');
    await waitFor(() => expect(code()).toContain('x-feature-status: new'));
    expect(code()).toContain('get:');

    await user.click(screen.getByLabelText('Only new, changed and removed endpoints'));
    await waitFor(() => expect(code()).not.toContain('get:'));
    expect(liveUrl()).toMatch(/openapi\.yaml\?feature=f&only=changes$/);
  });

  it('canvas export: marks the feature in the Mermaid flowchart', async () => {
    const user = userEvent.setup();
    act(() => useUiStore.getState().openDialog({ kind: 'export' }));
    await user.click(await screen.findByRole('radio', { name: 'Mermaid' }));
    await user.selectOptions(screen.getByLabelText('Scope'), 'f');
    await waitFor(() => expect(screen.getByLabelText('Canvas (Mermaid)').textContent).toContain('Feature: Orders'));
    expect(liveUrl()).toMatch(/canvas\.mmd\?feature=f$/);
  });
});

describe('feature export dialog', () => {
  it('shows the brief, the tasks and the migration in any dialect', async () => {
    const user = userEvent.setup();
    act(() => useUiStore.getState().openDialog({ kind: 'featureExport', id: 'f' }));
    expect((await screen.findByLabelText('Orders (Brief)')).textContent).toContain('# Feature: Orders');

    await user.click(screen.getByRole('radio', { name: 'Tasks' }));
    await waitFor(() => expect(screen.getByLabelText('Orders (Tasks)').textContent).toContain('Create table `orders`'));
    expect(screen.queryByLabelText('SQL dialect')).toBeNull();

    await user.click(screen.getByRole('radio', { name: 'Migration (up)' }));
    await user.selectOptions(screen.getByLabelText('SQL dialect'), 'mysql');
    await waitFor(() => expect(screen.getByLabelText('Orders (Migration (up))').textContent).toContain('for MySQL'));
    expect(liveUrl()).toMatch(/\/api\/projects\/p1\/features\/f\/migration\.up\.sql\?dialect=mysql$/);
  });
});
