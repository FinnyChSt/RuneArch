import { Wireframe, WireDevice } from '@flowcanvas/shared';
import { describe, expect, it } from 'vitest';
import { WIRE_TEMPLATES, wireframeFromTemplate } from './templates';

describe('wireframe templates', () => {
  const cases = WIRE_TEMPLATES.flatMap((t) => WireDevice.options.map((device) => [t.label, device, t] as const));

  it.each(cases)('%s on %s is a valid wireframe', (_, device, template) => {
    const wireframe = wireframeFromTemplate(template, device);
    expect(Wireframe.safeParse(wireframe).success).toBe(true);
    expect(wireframe.device).toBe(device);
    expect(wireframe.elements.length > 0).toBe(template.id !== 'blank');
  });

  it('gives every copy fresh element ids', () => {
    const template = WIRE_TEMPLATES.find((t) => t.id === 'login');
    const a = wireframeFromTemplate(template!, 'desktop').elements.map((e) => e.id);
    const b = wireframeFromTemplate(template!, 'desktop').elements.map((e) => e.id);
    expect(a.filter((id) => b.includes(id))).toEqual([]);
  });

  it('stacks side-by-side blocks on mobile', () => {
    const dashboard = WIRE_TEMPLATES.find((t) => t.id === 'dashboard')!;
    const cards = (device: WireDevice) =>
      wireframeFromTemplate(dashboard, device).elements.filter((e) => e.kind === 'card').map((e) => e.rect);
    expect(new Set(cards('desktop').map((r) => r.y)).size).toBe(1);
    expect(cards('mobile').every((r) => r.x === 0 && r.w === 12)).toBe(true);
    expect(new Set(cards('mobile').map((r) => r.y)).size).toBe(3);
  });
});
