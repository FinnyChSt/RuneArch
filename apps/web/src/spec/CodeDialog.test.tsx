// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DialogHost } from '../dialogs/DialogHost';
import { useCanvasStore } from '../store/canvasStore';
import { useUiStore } from '../store/uiStore';
import { shopDoc } from '../test/fixtures';

const withModel = () => ({
  ...shopDoc(),
  models: [{ id: 'm', name: 'OrderDto', fields: [{ id: 'f', name: 'userId', type: { kind: 'primitive' as const, type: 'string' as const }, required: true, nullable: false }] }],
});

beforeEach(() => {
  useUiStore.setState({ dialog: null, selection: [] });
  render(<DialogHost />);
});

afterEach(cleanup);

describe('code preview', () => {
  it('shows Pydantic models and switches to SQLAlchemy', async () => {
    useCanvasStore.getState().load(withModel(), 1, 'p1');
    const user = userEvent.setup();
    act(() => useUiStore.getState().openDialog({ kind: 'code' }));
    const pydantic = await screen.findByLabelText('Code (Pydantic)');
    expect(pydantic.textContent).toContain('class OrderDto(BaseModel):');
    expect(pydantic.textContent).toContain('user_id: str = Field(alias="userId")');

    await user.click(screen.getByRole('radio', { name: 'SQLAlchemy' }));
    await waitFor(() => expect(screen.getByLabelText('Code (SQLAlchemy)').textContent).toContain('class Order(Base):'));
    expect(screen.getByText(/ORM classes for the PostgreSQL tables/)).toBeTruthy();

    await user.click(screen.getByRole('radio', { name: 'SQLModel' }));
    await waitFor(() => expect(screen.getByLabelText('Code (SQLModel)').textContent).toContain('class Order(SQLModel, table=True):'));

    await user.click(screen.getByRole('radio', { name: 'FastAPI' }));
    await waitFor(() => expect(screen.getByLabelText('Code (FastAPI)').textContent).toContain('@app.post('));
    expect(screen.getByLabelText('Code (FastAPI)').textContent).toContain('def get_orders(');

    await user.click(screen.getByRole('radio', { name: 'Zod' }));
    await waitFor(() => expect(screen.getByLabelText('Code (Zod)').textContent).toContain('export const OrderDto = z.object({'));
    expect(screen.getByLabelText('Code (Zod)').textContent).toContain('userId: z.string(),');

    await user.click(screen.getByRole('radio', { name: 'Drizzle' }));
    await waitFor(() => expect(screen.getByLabelText('Code (Drizzle)').textContent).toContain("export const orders = pgTable("));

    await user.click(screen.getByRole('radio', { name: 'Prisma' }));
    await waitFor(() => expect(screen.getByLabelText('Code (Prisma)').textContent).toContain('model Order {'));
  });

  it('says when there is nothing to generate from', async () => {
    useCanvasStore.getState().load(shopDoc(), 1, 'p1');
    act(() => useUiStore.getState().openDialog({ kind: 'code' }));
    expect(await screen.findByText('No API models yet; add one in the API side panel.')).toBeTruthy();
  });
});
