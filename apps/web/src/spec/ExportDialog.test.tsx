// @vitest-environment jsdom
import { CanvasDoc } from '@flowcanvas/shared';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DialogHost } from '../dialogs/DialogHost';
import { useCanvasStore } from '../store/canvasStore';
import { useUiStore } from '../store/uiStore';
import { checkoutDoc } from '../test/fixtures';

const blobs: Blob[] = [];
const saved: string[] = [];
const click = HTMLAnchorElement.prototype.click;

beforeEach(() => {
  const doc = checkoutDoc();
  useCanvasStore
    .getState()
    .load(CanvasDoc.parse({ ...doc, flows: [{ id: 'f', name: 'Place order', color: 'teal', steps: [{ edgeId: 'e1' }, { edgeId: 'e2' }] }] }), 1, 'p1');
  useUiStore.setState({ dialog: null, selection: [] });
  blobs.length = 0;
  saved.length = 0;
  URL.createObjectURL = (blob: Blob) => (blobs.push(blob), `blob:${blobs.length}`);
  URL.revokeObjectURL = () => {};
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    saved.push(this.download);
  };
  render(<DialogHost />);
});

afterEach(() => {
  cleanup();
  HTMLAnchorElement.prototype.click = click;
});

/** The SVG shown in the preview */
const previewSvg = () => decodeURIComponent(screen.getByAltText('Canvas preview').getAttribute('src')!.split(',')[1]!);

describe('export dialog', () => {
  it('previews the canvas as SVG and downloads it, highlighting a flow', async () => {
    const user = userEvent.setup();
    act(() => useUiStore.getState().openDialog({ kind: 'export' }));
    const img = await screen.findByAltText('Canvas preview');
    expect(img.getAttribute('src')).toMatch(/^data:image\/svg\+xml/);
    const svg = previewSvg();
    expect(svg).toContain('/orders');
    expect(new DOMParser().parseFromString(svg, 'image/svg+xml').getElementsByTagName('parsererror')).toHaveLength(0);

    await user.selectOptions(screen.getByLabelText('Highlight flow'), 'f');
    await user.click(screen.getByRole('radio', { name: 'dark' }));
    await waitFor(() => expect(previewSvg()).toContain('Flow: Place order'));
    expect(previewSvg()).toContain('fill="#1B2635"');
    await user.click(screen.getByRole('button', { name: /Download SVG/ }));
    expect(saved).toEqual(['canvas-place-order.svg']);
    expect(await blobs.at(-1)!.text()).toBe(previewSvg());
  });

  it('shows the canvas as a Mermaid flowchart and as JSON', async () => {
    const user = userEvent.setup();
    act(() => useUiStore.getState().openDialog({ kind: 'export' }));
    await user.click(await screen.findByRole('radio', { name: 'Mermaid' }));
    await waitFor(() => expect(screen.getByLabelText('Canvas (Mermaid)').textContent).toContain('flowchart LR'));

    await user.click(screen.getByRole('radio', { name: 'JSON' }));
    await waitFor(() => expect(screen.getByLabelText('Canvas (JSON)').textContent).toContain('"format": "flowcanvas"'));
    expect(screen.queryByLabelText('Highlight flow')).toBeNull();
    await user.click(screen.getByRole('button', { name: /Download JSON/ }));
    expect(saved).toEqual(['canvas.json']);
  });
});
