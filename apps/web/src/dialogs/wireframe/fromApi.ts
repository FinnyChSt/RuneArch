import {
  modelRefOf,
  wireframeRows,
  type ApiModel,
  type Field,
  type WireElement,
  type Wireframe,
} from '@flowcanvas/shared';
import type { NodeOf } from '../../canvas/mapping';
import type { ElementLink } from '../../store/docOps';
import { newId } from '../../store/nodeFactory';

/*
 * "Generate from endpoint" for the wireframe editor: a form from an endpoint's request-body model,
 * a list or table from its response model. Pure; generated blocks go below everything else, and the
 * container element (form, list, table) keeps the model in `modelRef`. Rects are grid cells.
 */

type Endpoint = NodeOf<'endpoint'>;
type Rect = WireElement['rect'];

/** Result of a generator: the new wireframe and the element links it adds */
export type Generated = { wireframe: Wireframe; links: ElementLink[] };

/** What an endpoint can generate; `null` models come with the reason (shown on the disabled action) */
type Source = { model: ApiModel; reason?: never } | { model: null; reason: string };
export type EndpointSources = { request: Source; response: Source };

/** `firstName` / `shipping_method` → `First name` / `Shipping method` */
export function humanize(name: string): string {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
  const text = words.join(' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** `CreateOrderDto` → `Create order` */
export const modelTitle = (model: ApiModel) => humanize(model.name.replace(/(Dto|Request|Response|Model|Input|Payload)$/, '')) || model.name;

const byId = (models: readonly ApiModel[], id: string | undefined) => models.find((m) => m.id === id);

/** An array-of-model field of a wrapper like `{ items: OrderDto[], total }` */
const collectionField = (model: ApiModel) => model.fields.find((f) => f.type.kind === 'array' && f.type.items.kind === 'ref');

/** The models an endpoint's form and list/table would use */
export function endpointSources(endpoint: Endpoint, models: readonly ApiModel[]): EndpointSources {
  const { requestBody, responses } = endpoint.data.spec;
  const requestModel = requestBody?.type.kind === 'ref' ? byId(models, requestBody.type.modelId) : undefined;
  const request: Source = requestModel
    ? { model: requestModel }
    : { model: null, reason: requestBody ? 'The request body is not a model' : 'The endpoint has no request body' };

  // The first 2xx response with a list of models, directly or inside a wrapper model
  let responseModel: ApiModel | undefined;
  for (const r of responses) {
    if (!r.status.startsWith('2') || !r.body) continue;
    const body = r.body;
    if (body.kind === 'array') responseModel = byId(models, modelRefOf(body));
    else if (body.kind === 'ref') {
      const wrapper = byId(models, body.modelId);
      const inner = wrapper && collectionField(wrapper);
      responseModel = inner && byId(models, modelRefOf(inner.type));
    }
    if (responseModel) break;
  }
  const response: Source = responseModel
    ? { model: responseModel }
    : { model: null, reason: 'No success response returns a list of models' };
  return { request, response };
}

/** Fields the server sets itself; a form doesn't ask for them */
const SERVER_FIELDS = /^(id|createdAt|updatedAt|deletedAt|created_at|updated_at|deleted_at)$/;
const LONG_TEXT = /(description|notes?|comment|message|bio|body|content)$/i;

/** One form control per field: checkbox, select (enums, model refs), text area, or input */
function control(field: Field): Pick<WireElement, 'kind' | 'text' | 'items'> & { h: number } {
  const text = humanize(field.name);
  const { type } = field;
  if (type.kind === 'primitive') {
    if (type.type === 'boolean') return { kind: 'checkbox', text, h: 3 };
    if (type.enum?.length) return { kind: 'select', text, items: [...type.enum], h: 5 };
    if (type.type === 'string' && LONG_TEXT.test(field.name)) return { kind: 'textarea', text, h: 10 };
    return { kind: 'input', text, h: 5 };
  }
  if (type.kind === 'ref') return { kind: 'select', text, h: 5 };
  return { kind: 'textarea', text: `${text} (one per line)`, h: 10 };
}

const SUBMIT: Record<Endpoint['data']['method'], string> = {
  GET: 'Search',
  POST: 'Create',
  PUT: 'Save',
  PATCH: 'Save',
  DELETE: 'Delete',
};

/** First free row below everything, leaving one empty row */
const nextRow = (wf: Wireframe) => {
  const rows = wireframeRows(wf);
  return rows === 0 ? 0 : rows + 1;
};

/**
 * A form for the request-body model: a titled form box, one control per field, and a submit button
 * that calls the endpoint.
 */
export function formFromEndpoint(wf: Wireframe, endpoint: Endpoint, model: ApiModel, id: () => string = newId): Generated {
  const mobile = wf.device === 'mobile';
  const top = nextRow(wf);
  let y = top + 4; // below the form's title
  const fields: WireElement[] = model.fields
    .filter((f) => !SERVER_FIELDS.test(f.name))
    .map((f) => {
      const { h, ...content } = control(f);
      const el: WireElement = { id: id(), ...content, rect: { x: 1, y, w: 10, h } };
      y += h + 1;
      return el;
    });
  const submitRect: Rect = mobile ? { x: 1, y: y + 1, w: 10, h: 5 } : { x: 8, y: y + 1, w: 3, h: 5 };
  const submit: WireElement = { id: id(), kind: 'button', text: SUBMIT[endpoint.data.method], variant: 'primary', rect: submitRect };
  const form: WireElement = {
    id: id(),
    kind: 'form',
    text: endpoint.data.spec.summary?.trim() || modelTitle(model),
    modelRef: model.id,
    rect: { x: 0, y: top, w: 12, h: submitRect.y + submitRect.h + 2 - top },
  };
  return {
    // The form box first, so the fields draw on top of it
    wireframe: { ...wf, elements: [...wf.elements, form, ...fields, submit] },
    links: [{ id: id(), elementId: submit.id, targetId: endpoint.id }],
  };
}

/** A list (one row per item) or a table (one column per field) for the response's item model */
export function collectionFromEndpoint(
  wf: Wireframe,
  model: ApiModel,
  kind: 'list' | 'table',
  id: () => string = newId,
): Generated {
  const top = nextRow(wf);
  const title = modelTitle(model);
  const el: WireElement =
    kind === 'list'
      ? { id: id(), kind, items: [1, 2, 3].map((n) => `${title} ${n}`), modelRef: model.id, rect: { x: 0, y: top, w: 12, h: 20 } }
      : {
          id: id(),
          kind,
          // Scalar fields make the columns; a phone has room for about three
          items: model.fields
            .filter((f) => f.type.kind === 'primitive')
            .slice(0, wf.device === 'mobile' ? 3 : 6)
            .map((f) => humanize(f.name)),
          modelRef: model.id,
          rect: { x: 0, y: top, w: 12, h: 17 },
        };
  if (el.items?.length === 0) el.items = [title];
  return { wireframe: { ...wf, elements: [...wf.elements, el] }, links: [] };
}
