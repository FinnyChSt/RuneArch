// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DialogHost } from '../dialogs/DialogHost';
import { useCanvasStore } from '../store/canvasStore';
import { useUiStore } from '../store/uiStore';
import { shopDoc } from '../test/fixtures';

beforeEach(() => {
  useCanvasStore.getState().load(shopDoc(), 1, 'p1');
  useUiStore.setState({ dialog: null, selection: [] });
  render(<DialogHost />);
});

afterEach(cleanup);

describe('schema preview', () => {
  it('shows the tables as DBML and switches to Mermaid and SQL', async () => {
    const user = userEvent.setup();
    act(() => useUiStore.getState().openDialog({ kind: 'schema' }));
    expect((await screen.findByLabelText('Database schema (DBML)')).textContent).toContain('Table orders {');

    await user.click(screen.getByRole('radio', { name: 'Mermaid' }));
    await waitFor(() => expect(screen.getByLabelText('Database schema (Mermaid)').textContent).toContain('erDiagram'));

    await user.click(screen.getByRole('radio', { name: 'SQL' }));
    await waitFor(() => expect(screen.getByLabelText('Database schema (SQL)').textContent).toContain('CREATE TABLE orders'));
  });

  it('previews another database, then converts the tables in one undo step', async () => {
    const user = userEvent.setup();
    const temporal = useCanvasStore.temporal.getState;
    const idType = () => {
      const users = useCanvasStore.getState().doc.nodes.find((n) => n.id === 'users');
      return users?.type === 'table' ? users.data.columns[0]!.type : undefined;
    };
    act(() => useUiStore.getState().openDialog({ kind: 'schema' }));
    await user.click(await screen.findByRole('radio', { name: 'SQL' }));
    await user.selectOptions(screen.getByLabelText('Project database'), 'mysql');

    // Only the preview changes until the conversion is applied
    await waitFor(() => expect(screen.getByLabelText('Database schema (SQL)').textContent).toContain('id char(36) PRIMARY KEY'));
    expect(useCanvasStore.getState().doc.database.dialect).toBe('postgresql');
    expect(idType()).toBe('uuid');

    const before = temporal().pastStates.length;
    await user.click(screen.getByRole('button', { name: 'Convert tables to MySQL' }));
    expect(useCanvasStore.getState().doc.database.dialect).toBe('mysql');
    expect(idType()).toBe('char(36)');
    expect(temporal().pastStates.length).toBe(before + 1);
    expect(screen.queryByRole('button', { name: /Convert tables/ })).toBeNull();
  });
});
