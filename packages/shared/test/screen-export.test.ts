import { describe, expect, it } from 'vitest';
import {
  CanvasDoc,
  describeScreens,
  emptyCanvas,
  screenExportByExtension,
  SCREEN_EXPORTS,
  toScreensMarkdown,
  Wireframe,
  WireKind,
  wireframeToSvg,
} from '../src';

const str = { kind: 'primitive', type: 'string' } as const;

/** Home → Cart; Cart has a form bound to CreateOrderDto whose button calls POST /orders, plus a screen-level GET */
const doc = CanvasDoc.parse({
  ...emptyCanvas(),
  models: [
    { id: 'addr', name: 'AddressDto', fields: [{ id: 'z', name: 'zip', type: str }] },
    {
      id: 'create',
      name: 'CreateOrderDto',
      fields: [
        { id: 'a', name: 'address', type: { kind: 'ref', modelId: 'addr' } },
        { id: 'n', name: 'note', type: str, required: false, nullable: true },
      ],
    },
    { id: 'order', name: 'OrderDto', fields: [{ id: 'i', name: 'id', type: str }] },
    { id: 'unused', name: 'UnusedDto', fields: [] },
  ],
  nodes: [
    {
      id: 'cart',
      type: 'screen',
      label: 'Cart',
      position: { x: 0, y: 0 },
      notes: 'Shows the basket.',
      data: {
        route: '/cart',
        state: ['cart'],
        wireframe: {
          device: 'mobile',
          elements: [
            { id: 'place', kind: 'button', rect: { x: 8, y: 30, w: 4, h: 5 }, text: 'Place order', variant: 'primary' },
            { id: 'form', kind: 'form', rect: { x: 0, y: 10, w: 12, h: 28 }, text: 'Checkout', modelRef: 'create' },
            { id: 'div', kind: 'divider', rect: { x: 0, y: 9, w: 12, h: 1 } },
            { id: 'head', kind: 'header', rect: { x: 0, y: 0, w: 12, h: 7 }, text: 'Shop <&>', items: ['Home'] },
          ],
        },
      },
    },
    { id: 'home', type: 'screen', label: 'Home', position: { x: 0, y: 300 }, data: {} },
    {
      id: 'post',
      type: 'endpoint',
      position: { x: 300, y: 0 },
      data: {
        method: 'POST',
        path: '/orders',
        spec: {
          summary: 'Place an order',
          requestBody: { type: { kind: 'ref', modelId: 'create' } },
          responses: [{ status: '201', description: 'Created', body: { kind: 'ref', modelId: 'order' } }, { status: '400' }],
        },
      },
    },
    { id: 'me', type: 'endpoint', position: { x: 300, y: 200 }, data: { method: 'GET', path: '/me' } },
    { id: 'store', type: 'store', label: 'cartStore', position: { x: 300, y: 400 }, data: {} },
  ],
  edges: [
    { id: 'click', kind: 'calls', source: 'cart', target: 'post', sourceHandle: 'el:place' },
    { id: 'load', kind: 'calls', source: 'cart', target: 'me' },
    { id: 'nav', kind: 'navigates', source: 'home', target: 'cart' },
    { id: 'st', kind: 'reads', source: 'cart', target: 'store' },
  ],
  flows: [],
});

describe('describeScreens', () => {
  const { screens, models } = describeScreens(doc);
  const cart = screens[0]!;

  it('describes each screen with its elements in reading order', () => {
    expect(screens.map((s) => s.name)).toEqual(['Cart', 'Home']);
    expect(cart).toMatchObject({ route: '/cart', device: 'mobile', state: ['cart'], notes: 'Shows the basket.', reachedFrom: ['Home'] });
    expect(cart.elements.map((e) => [e.kind, e.text, e.model])).toEqual([
      ['header', 'Shop <&>', undefined],
      ['form', 'Checkout', 'CreateOrderDto'],
      ['button', 'Place order', undefined],
    ]);
    expect(cart.elements[2]?.actions).toEqual([{ kind: 'calls', target: 'POST /orders' }]);
    expect(cart.actions).toEqual([{ kind: 'reads', target: 'cartStore' }]);
    expect(screens[1]).toMatchObject({ elements: [], calls: [], reachedFrom: [] });
  });

  it('lists called endpoints with their triggers, bodies and responses', () => {
    expect(cart.calls).toEqual([
      {
        method: 'POST',
        path: '/orders',
        summary: 'Place an order',
        triggers: ['Place order'],
        requestBody: 'CreateOrderDto',
        responses: [{ status: '201', description: 'Created', body: 'OrderDto' }, { status: '400' }],
      },
      { method: 'GET', path: '/me', triggers: ['screen'], responses: [{ status: '200' }] },
    ]);
  });

  it('includes the models the screens use, following nested refs', () => {
    expect(models.map((m) => m.name)).toEqual(['AddressDto', 'CreateOrderDto', 'OrderDto']);
    expect(models[1]?.fields).toEqual([
      { name: 'address', type: 'AddressDto', required: true, nullable: false },
      { name: 'note', type: 'string', required: false, nullable: true },
    ]);
  });
});

describe('components in screen descriptions', () => {
  const withCard = CanvasDoc.parse({
    ...emptyCanvas(),
    models: [{ id: 'p', name: 'ProductDto', fields: [] }],
    nodes: [
      {
        id: 'card',
        type: 'component',
        label: 'ProductCard',
        position: { x: 0, y: 0 },
        data: {
          props: ['product'],
          wireframe: { elements: [{ id: 'l', kind: 'list', rect: { x: 0, y: 0, w: 12, h: 10 }, modelRef: 'p' }] },
        },
      },
      { id: 'unused', type: 'component', label: 'Unused', position: { x: 0, y: 0 }, data: {} },
      {
        id: 's',
        type: 'screen',
        label: 'Shop',
        position: { x: 0, y: 0 },
        data: { wireframe: { elements: [{ id: 'i', kind: 'instance', componentId: 'card', rect: { x: 0, y: 0, w: 6, h: 10 } }] } },
      },
    ],
  });

  it('names placed components and describes each once, with the models it uses', () => {
    const { screens, components, models } = describeScreens(withCard);
    expect(screens[0]?.elements).toEqual([{ id: 'i', kind: 'instance', component: 'ProductCard', actions: [] }]);
    expect(components).toEqual([
      { name: 'ProductCard', props: ['product'], elements: [{ id: 'l', kind: 'list', model: 'ProductDto', actions: [] }] },
    ]);
    expect(models.map((m) => m.name)).toEqual(['ProductDto']);
    const md = toScreensMarkdown(withCard);
    expect(md).toContain('- component `ProductCard`');
    expect(md).toContain('## Components\n\n### ProductCard\n\nProps: `product`\n\n- list — model `ProductDto`');
  });
});

describe('screen exports', () => {
  it('renders markdown', () => {
    expect(toScreensMarkdown(doc)).toMatchInlineSnapshot(`
      "# Screens

      <!-- Generated by RuneArch -->

      ## Cart (\`/cart\`)

      Device: mobile · State: \`cart\` · Reached from: Home

      Shows the basket.

      ### Layout

      - header "Shop <&>" (Home)
      - form "Checkout" — model \`CreateOrderDto\`
      - button "Place order" → calls \`POST /orders\`

      ### Links

      - reads cartStore

      ### Calls

      - \`POST /orders\` — Place an order (on "Place order")
        - Body: \`CreateOrderDto\`
        - 201: \`OrderDto\` — Created
        - 400
      - \`GET /me\`
        - 200

      ## Home

      ### Layout

      No wireframe.

      ### Links

      - navigates Cart

      ## Models

      ### AddressDto

      - zip: \`string\`

      ### CreateOrderDto

      - address: \`AddressDto\`
      - note?: \`string | null\`

      ### OrderDto

      - id: \`string\`
      "
    `);
  });

  it('renders JSON that round-trips to the description', () => {
    expect(JSON.parse(SCREEN_EXPORTS.json.render(doc))).toEqual(describeScreens(doc));
  });

  it('finds formats by extension', () => {
    expect(screenExportByExtension('md')?.label).toBe('Markdown');
    expect(screenExportByExtension('json')?.label).toBe('JSON');
    expect(screenExportByExtension('txt')).toBeUndefined();
  });
});

describe('wireframeToSvg', () => {
  it('draws every element kind at design width, escaping text', () => {
    const elements = WireKind.options.map((kind, i) => ({
      id: kind,
      kind,
      rect: { x: 0, y: i * 10, w: 12, h: 8 },
      text: `${kind} <b>`,
      items: ['One', 'Two & three'],
      ...(kind === 'instance' && { componentId: 'missing' }),
    }));
    const svg = wireframeToSvg(Wireframe.parse({ device: 'tablet', elements }), { title: 'Cart "main"' });
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="560" height="\d+"/);
    for (const kind of WireKind.options) expect(svg).toContain(`data-kind="${kind}"`);
    expect(svg).toContain('Cart &quot;main&quot;');
    expect(svg).toContain('Two &amp; three');
    expect(svg).not.toContain('<b>');
    // Page height: title + (rows + 2 blank rows) × 8px
    expect(svg).toContain(`height="${32 + (WireKind.options.length * 10 - 2 + 2) * 8}"`);
  });

  it('reflows a component into each instance', () => {
    const card = Wireframe.parse({ elements: [{ id: 'b', kind: 'button', rect: { x: 6, y: 0, w: 6, h: 5 }, text: 'Add to cart' }] });
    const components = new Map([
      ['card', { name: 'ProductCard', wireframe: card }],
      ['empty', { name: 'EmptyThing' }],
    ]);
    const page = Wireframe.parse({
      elements: [
        { id: 'i1', kind: 'instance', componentId: 'card', rect: { x: 0, y: 0, w: 6, h: 6 } },
        { id: 'i2', kind: 'instance', componentId: 'empty', rect: { x: 6, y: 0, w: 6, h: 6 } },
      ],
    });
    const svg = wireframeToSvg(page, { components });
    // Instance box: 6 columns of 800/12 less the gutters = 394 px; the button takes its right half
    expect(svg).toContain('<svg x="3" y="3" width="394" height="42" data-kind="instance">');
    expect(svg).toContain(`<svg x="${394 / 2 + 3}" y="3" width="${394 / 2 - 6}" height="34" data-kind="button">`);
    expect(svg).toContain('Add to cart');
    expect(svg).toContain('EmptyThing');
  });
});
