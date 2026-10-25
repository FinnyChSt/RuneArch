import type { FieldType } from '@flowcanvas/shared';
import { describe, expect, it } from 'vitest';
import { fromTypeDraft, toTypeDraft } from './typeDraft';

describe('type draft', () => {
  it.each<[string, FieldType]>([
    ['string', { kind: 'primitive', type: 'string' }],
    ['uuid', { kind: 'primitive', type: 'string', format: 'uuid' }],
    ['enum', { kind: 'primitive', type: 'string', enum: ['draft', 'paid'] }],
    ['int64', { kind: 'primitive', type: 'integer', format: 'int64' }],
    ['model ref', { kind: 'ref', modelId: 'm1' }],
    ['list of models', { kind: 'array', items: { kind: 'ref', modelId: 'm1' } }],
    ['list of numbers', { kind: 'array', items: { kind: 'primitive', type: 'number', format: 'double' } }],
  ])('round-trips %s', (_, type) => {
    expect(fromTypeDraft(toTypeDraft(type))).toEqual({ ...type, ...(type.kind === 'primitive' && { format: type.format, enum: type.enum }) });
  });

  it('drops formats and enums that do not fit the chosen primitive', () => {
    expect(fromTypeDraft({ base: 'p:integer', list: false, format: 'uuid', enumValues: 'a, b' })).toEqual({
      kind: 'primitive',
      type: 'integer',
      format: undefined,
      enum: undefined,
    });
    expect(fromTypeDraft({ base: 'p:string', list: false, format: '', enumValues: ' a, b ,a,, ' })).toMatchObject({
      enum: ['a', 'b'],
    });
  });
});
