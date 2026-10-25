import type { FieldType, PrimitiveType } from '@flowcanvas/shared';

/*
 * Flat form shape for a FieldType, so each part can be a plain form control:
 * `base` is 'p:<primitive>' or 'm:<modelId>'; `list` wraps it in an array.
 */
export type TypeDraft = { base: string; list: boolean; format: string; enumValues: string };

type Primitive = PrimitiveType['type'];
type Format = NonNullable<PrimitiveType['format']>;

export const PRIMITIVES: Primitive[] = ['string', 'integer', 'number', 'boolean'];

/** Formats that make sense per primitive */
export const FORMATS: Record<Primitive, Format[]> = {
  string: ['uuid', 'email', 'uri', 'date', 'date-time'],
  integer: ['int32', 'int64'],
  number: ['float', 'double'],
  boolean: [],
};

export const primitiveBase = (type: Primitive) => `p:${type}`;
export const modelBase = (modelId: string) => `m:${modelId}`;

export const STRING_TYPE: TypeDraft = { base: 'p:string', list: false, format: '', enumValues: '' };

export function toTypeDraft(type: FieldType): TypeDraft {
  const item = type.kind === 'array' ? type.items : type;
  const list = type.kind === 'array';
  if (item.kind === 'ref') return { base: modelBase(item.modelId), list, format: '', enumValues: '' };
  return { base: primitiveBase(item.type), list, format: item.format ?? '', enumValues: item.enum?.join(', ') ?? '' };
}

export function toPrimitive(draft: TypeDraft): PrimitiveType {
  const type = (PRIMITIVES.find((p) => draft.base === primitiveBase(p)) ?? 'string') as Primitive;
  const format = FORMATS[type].includes(draft.format as Format) ? (draft.format as Format) : undefined;
  const values = draft.enumValues
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  // Enums only for strings: the designer keeps enum values as text
  return { kind: 'primitive', type, format, enum: type === 'string' && values.length ? [...new Set(values)] : undefined };
}

export function fromTypeDraft(draft: TypeDraft): FieldType {
  const item = draft.base.startsWith('m:')
    ? ({ kind: 'ref', modelId: draft.base.slice(2) } as const)
    : toPrimitive(draft);
  return draft.list ? { kind: 'array', items: item } : item;
}
