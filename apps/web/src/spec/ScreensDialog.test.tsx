// @vitest-environment jsdom
import { Wireframe, WireKind, wireframeToSvg } from '@flowcanvas/shared';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DialogHost } from '../dialogs/DialogHost';
import { useCanvasStore } from '../store/canvasStore';
import { useUiStore } from '../store/uiStore';
import { wireframedCheckoutDoc } from '../test/fixtures';

beforeEach(() => {
  useCanvasStore.getState().load(wireframedCheckoutDoc(), 1, 'p1');
  useUiStore.setState({ dialog: null, selection: [] });
  render(<DialogHost />);
});

afterEach(cleanup);

describe('screens preview', () => {
  it('describes the screens as Markdown and switches to JSON', async () => {
    const user = userEvent.setup();
    act(() => useUiStore.getState().openDialog({ kind: 'screens' }));
    const markdown = (await screen.findByLabelText('Screens (Markdown)')).textContent;
    expect(markdown).toContain('## Cart (`/cart`)');
    expect(markdown).toContain('- button "Place order" → calls `POST /orders`');

    await user.click(screen.getByRole('radio', { name: 'JSON' }));
    await waitFor(() => expect(screen.getByLabelText('Screens (JSON)').textContent).toContain('"triggers"'));
  });
});

describe('wireframe SVG', () => {
  it('is well-formed SVG for every element kind', () => {
    const elements = WireKind.options.map((kind, i) => ({
      id: kind,
      kind,
      rect: { x: 0, y: i * 10, w: 12, h: 8 },
      text: `${kind} <"&">`,
      items: ["It's", 'a & b'],
      ...(kind === 'instance' && { componentId: 'gone' }),
    }));
    const svg = wireframeToSvg(Wireframe.parse({ elements }), { title: 'A <b>' });
    const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml');
    expect(parsed.getElementsByTagName('parsererror')).toHaveLength(0);
    expect(parsed.documentElement.getAttribute('width')).toBe('800');
    expect(parsed.querySelectorAll('svg > svg')).toHaveLength(WireKind.options.length);
  });
});
