// @vitest-environment jsdom
import { featureById, roleOf, type FeatureItemRef } from '@flowcanvas/shared';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReactFlowProvider } from '@xyflow/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ContextMenu } from '../canvas/ContextMenu';
import { DialogHost } from '../dialogs/DialogHost';
import { undo, useCanvasStore } from '../store/canvasStore';
import { useUiStore } from '../store/uiStore';
import { shopDoc } from '../test/fixtures';
import { FeatureBar } from './FeatureBar';
import { FeaturesPanel } from './FeaturesPanel';

const store = () => useCanvasStore.getState();
const ui = () => useUiStore.getState();
const node = (id: string): FeatureItemRef => ({ kind: 'node', id });
const first = () => store().doc.features[0]!;

beforeEach(() => {
  store().load(shopDoc(), 1, 'p1');
  useUiStore.setState({
    activeFlowId: null,
    viewFeatureId: null,
    hideUnshipped: false,
    contextMenu: null,
    dialog: null,
    selection: [],
  });
  render(
    <ReactFlowProvider>
      <FeaturesPanel />
      <FeatureBar />
      <ContextMenu />
      <DialogHost />
    </ReactFlowProvider>,
  );
});

afterEach(cleanup);

/** Creates "Wishlist" through the panel; it is then worked on and highlighted */
async function createWishlist(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'New feature' }));
  await user.type(screen.getByLabelText('Feature name'), 'Wishlist');
  await user.click(screen.getByRole('radio', { name: 'rose' }));
  await user.click(screen.getByRole('button', { name: 'Create and work on it' }));
  return first().id;
}

describe('features panel', () => {
  it('creating a feature works on it and highlights it; the bar stops working', async () => {
    const user = userEvent.setup();
    const id = await createWishlist(user);
    expect(first()).toMatchObject({ name: 'Wishlist', color: 'rose', items: [] });
    expect(store().activeFeatureId).toBe(id);
    expect(ui().viewFeatureId).toBe(id);
    expect(screen.getByRole('status').textContent).toContain('Working on Wishlist');
    expect(screen.getByText(/What you add or edit on the canvas now is tagged/)).toBeTruthy();

    await user.click(within(screen.getByRole('status')).getByRole('button', { name: 'Stop' }));
    expect(store().activeFeatureId).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Work on Wishlist' }));
    expect(store().activeFeatureId).toBe(id);
  });

  it('lists tagged items by role, changes roles, saves notes and takes items out', async () => {
    const user = userEvent.setup();
    const id = await createWishlist(user);
    act(() => {
      store().addNode('table', { x: 0, y: 0 });
      store().setFeatureItem(id, node('users'), 'uses');
    });
    expect(screen.getByRole('button', { name: /^Wishlist/ }).textContent).toContain('Draft · +1 · 1 existing');
    expect(screen.getByRole('heading', { name: 'New · 1' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Existing · 1' })).toBeTruthy();

    await user.selectOptions(screen.getByLabelText('Role of users'), 'changed');
    expect(roleOf(first(), node('users'))).toBe('changed');
    expect(first().baseline.nodes.users).toBeDefined();

    const note = screen.getByLabelText('Note for users');
    await user.type(note, 'stores the wish count{Enter}');
    expect(first().items.find((i) => i.ref.id === 'users')?.note).toBe('stores the wish count');

    await user.click(screen.getByRole('button', { name: 'Take users out of the feature' }));
    expect(roleOf(first(), node('users'))).toBeUndefined();
    act(() => undo());
    expect(roleOf(first(), node('users'))).toBe('changed');
  });

  it('clicking an item selects it on the canvas', async () => {
    const user = userEvent.setup();
    const id = await createWishlist(user);
    act(() => store().setFeatureItem(id, node('orders'), 'uses'));
    await user.click(screen.getByRole('button', { name: 'orders' }));
    expect(ui().selection).toEqual(['orders']);
    expect(ui().fitRequest?.nodeIds).toEqual(['orders']);
  });

  it('toggles the highlight and "hide unshipped"', async () => {
    const user = userEvent.setup();
    const id = await createWishlist(user);
    await user.click(screen.getByRole('button', { name: 'Show whole canvas' }));
    expect(ui().viewFeatureId).toBeNull();
    await user.click(screen.getByRole('button', { name: /^Wishlist/ }));
    expect(ui().viewFeatureId).toBe(id);
    await user.click(screen.getByLabelText('Hide what unshipped features add'));
    expect(ui().hideUnshipped).toBe(true);
  });

  it('edits name, status, acceptance criteria, questions and flows in the dialog (one undo step)', async () => {
    const user = userEvent.setup();
    const id = await createWishlist(user);
    await user.click(screen.getByRole('button', { name: 'Edit Wishlist' }));
    const dialog = screen.getByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText('Status'), 'in-progress');
    await user.type(within(dialog).getByLabelText('Acceptance criteria'), 'Save a product{Enter}{Enter}Remove it');
    await user.type(within(dialog).getByLabelText('Open questions'), 'Limit per user?');
    await user.click(within(dialog).getByRole('checkbox', { name: 'Order' }));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(featureById(store().doc, id)).toMatchObject({
      status: 'in-progress',
      acceptance: ['Save a product', 'Remove it'],
      openQuestions: ['Limit per user?'],
      flowIds: ['f'],
    });
    act(() => undo());
    expect(first().status).toBe('draft');
  });

  it('rejects an empty name in the dialog', async () => {
    const user = userEvent.setup();
    await createWishlist(user);
    await user.click(screen.getByRole('button', { name: 'Edit Wishlist' }));
    const dialog = screen.getByRole('dialog');
    await user.clear(within(dialog).getByLabelText('Name'));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(within(dialog).getByRole('alert').textContent).toContain('Name is required');
    expect(first().name).toBe('Wishlist');
  });
});

describe('context menu', () => {
  it('sets the role of a node in the feature being worked on, or takes it out', async () => {
    const user = userEvent.setup();
    const id = await createWishlist(user);
    act(() => ui().openContextMenu({ x: 10, y: 10, ref: node('orders') }));
    const menu = screen.getByRole('menu');
    expect(menu.textContent).toContain('orders');
    await user.click(within(menu).getByRole('menuitemradio', { name: 'Removed by the feature' }));
    expect(roleOf(featureById(store().doc, id)!, node('orders'))).toBe('removed');
    expect(screen.queryByRole('menu')).toBeNull();

    act(() => ui().openContextMenu({ x: 10, y: 10, ref: node('orders') }));
    expect(screen.getByRole('menuitemradio', { name: 'Removed by the feature' }).getAttribute('aria-checked')).toBe('true');
    await user.click(screen.getByRole('menuitem', { name: 'Take out of the feature' }));
    expect(roleOf(featureById(store().doc, id)!, node('orders'))).toBeUndefined();
  });

  it('without a feature in focus, offers every feature; Esc closes it', async () => {
    const user = userEvent.setup();
    act(() => {
      store().addFeature({ name: 'Wishlist' });
      store().addFeature({ name: 'Reviews' });
      ui().openContextMenu({ x: 10, y: 10, ref: { kind: 'edge', id: 'w' } });
    });
    expect(screen.getByRole('menu').textContent).toContain('POST /orders → orders · writes');
    await user.click(screen.getByRole('menuitem', { name: 'Use in Reviews' }));
    expect(roleOf(store().doc.features[1]!, { kind: 'edge', id: 'w' })).toBe('uses');
    expect(store().doc.features[0]!.items).toEqual([]);

    act(() => ui().openContextMenu({ x: 10, y: 10, ref: node('users') }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('points to the Features tab when there are no features', async () => {
    const user = userEvent.setup();
    act(() => ui().openContextMenu({ x: 10, y: 10, ref: node('users') }));
    await user.click(screen.getByRole('menuitem', { name: /No features yet/ }));
    expect(ui().rightPanel).toBe('features');
  });
});

describe('changes and warnings', () => {
  /** Wishlist changes users (adds a NOT NULL column), adds POST /wishlist, and tells the Order flow's story */
  async function changedWishlist(user: ReturnType<typeof userEvent.setup>) {
    const id = await createWishlist(user);
    act(() => {
      const users = store().doc.nodes.find((n) => n.id === 'users')!;
      if (users.type !== 'table') throw new Error('not a table');
      const wish = { id: 'u_wish', name: 'wish_count', type: 'int', primaryKey: false, nullable: false, unique: false };
      store().editNode({ ...users, data: { ...users.data, columns: [...users.data.columns, wish] } });
      store().saveFeature({ ...featureById(store().doc, id)!, flowIds: ['f'] });
    });
    return id;
  }

  it('shows warnings, applies the API version hint and adds flow nodes as existing', async () => {
    const user = userEvent.setup();
    const id = await changedWishlist(user);
    act(() => store().setFeatureItem(id, node('get'), 'removed'));
    const warnings = screen.getByRole('region', { name: 'Warnings' });
    expect(warnings.textContent).toContain('users.wish_count is NOT NULL without a default');
    expect(warnings.textContent).toContain('GET /orders is removed');
    expect(warnings.textContent).toContain('API: major change (0.1.0 → 1.0.0)');
    expect(warnings.textContent).toContain('Flow Order passes through POST /orders, which is not in the feature');

    await user.click(within(warnings).getByRole('button', { name: 'Apply' }));
    expect(store().doc.api.version).toBe('1.0.0');

    await user.click(within(warnings).getAllByRole('button', { name: 'Add as existing' })[0]!);
    expect(roleOf(featureById(store().doc, id)!, node('post'))).toBe('uses');
  });

  it('lists the changes of an item and reverts one, then the whole item', async () => {
    const user = userEvent.setup();
    const id = await changedWishlist(user);
    act(() => {
      const users = store().doc.nodes.find((n) => n.id === 'users')!;
      store().updateNode('users', { label: 'members', data: users.data });
    });
    await user.click(screen.getByRole('button', { name: '2 changes' }));
    expect(screen.getByText('Name: users → members')).toBeTruthy();
    expect(screen.getByText('+ Column wish_count')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Revert: Name: users → members' }));
    expect(store().doc.nodes.find((n) => n.id === 'users')!.label).toBe('users');
    expect(roleOf(featureById(store().doc, id)!, node('users'))).toBe('changed');

    await user.click(screen.getByRole('button', { name: 'Revert users to before the feature' }));
    const users = store().doc.nodes.find((n) => n.id === 'users')!;
    expect(users.type === 'table' && users.data.columns.map((c) => c.name)).toEqual(['id', 'email']);
    expect(roleOf(featureById(store().doc, id)!, node('users'))).toBe('uses');
  });

  it('dialogs show the live changes against the baseline, and what saving will tag', async () => {
    const user = userEvent.setup();
    await changedWishlist(user);
    act(() => ui().openDialog({ kind: 'table', id: 'users' }));
    let box = screen.getByRole('region', { name: 'Changes against the baseline' });
    expect(box.textContent).toContain('Changes in Wishlist · 1');
    expect(box.textContent).toContain('+ Column wish_count');
    act(() => ui().closeDialog());

    act(() => ui().openDialog({ kind: 'table', id: 'orders' }));
    expect(screen.queryByRole('region', { name: 'Changes against the baseline' })).toBeNull();
    await user.clear(within(screen.getByRole('dialog')).getByLabelText('Table name'));
    await user.type(within(screen.getByRole('dialog')).getByLabelText('Table name'), 'purchases');
    box = screen.getByRole('region', { name: 'Changes against the baseline' });
    expect(box.textContent).toContain('Saving marks this as changed in Wishlist');
  });
});
