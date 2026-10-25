import { modelRefOf, type ApiModel, type FieldType } from './api';
import type { CanvasDoc } from './canvas';

/** Readable type, e.g. `string (uuid)`, `OrderDto`, `OrderDto[]`, `'draft' | 'paid'` */
export function typeLabel(type: FieldType, models: readonly ApiModel[]): string {
  switch (type.kind) {
    case 'primitive':
      if (type.enum?.length) return type.enum.map((v) => `'${v}'`).join(' | ');
      return type.format ? `${type.type} (${type.format})` : type.type;
    case 'ref':
      return models.find((m) => m.id === type.modelId)?.name ?? 'unknown model';
    case 'array':
      return `${typeLabel(type.items, models)}[]`;
  }
}

/** Where a model is referenced, e.g. "POST /orders body", "OrderListDto.items", "Checkout · form" */
export function modelUsages(doc: Pick<CanvasDoc, 'nodes' | 'models'>, modelId: string): string[] {
  const uses = (t: FieldType | undefined) => t !== undefined && modelRefOf(t) === modelId;
  const usages: string[] = [];
  for (const m of doc.models) {
    if (m.id === modelId) continue;
    for (const f of m.fields) if (uses(f.type)) usages.push(`${m.name}.${f.name}`);
  }
  for (const n of doc.nodes) {
    if (n.type !== 'endpoint') continue;
    const route = `${n.data.method} ${n.data.path}`;
    if (uses(n.data.spec.requestBody?.type)) usages.push(`${route} body`);
    for (const r of n.data.spec.responses) if (uses(r.body)) usages.push(`${route} ${r.status} response`);
  }
  for (const n of doc.nodes) {
    if (n.type !== 'screen' && n.type !== 'component') continue;
    for (const el of n.data.wireframe?.elements ?? [])
      if (el.modelRef === modelId) usages.push(`${n.label || n.type} · ${el.text?.trim() || el.kind}`);
  }
  return usages;
}
