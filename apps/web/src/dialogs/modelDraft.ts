import { modelFromTable, type ApiModel, type CanvasDoc, type TableNode } from '@flowcanvas/shared';
import { upsertModel } from '../store/docOps';
import { newId } from '../store/nodeFactory';
import { fromTypeDraft, STRING_TYPE, toTypeDraft, type TypeDraft } from './typeDraft';
import type { IssueMapper } from './validation';

export type FieldDraft = {
  id: string;
  name: string;
  type: TypeDraft;
  required: boolean;
  nullable: boolean;
  example: string;
  description: string;
};

export type ModelDraft = { name: string; description: string; sourceTableId: string; fields: FieldDraft[] };

const toFieldDraft = (f: ApiModel['fields'][number]): FieldDraft => ({
  id: f.id,
  name: f.name,
  type: toTypeDraft(f.type),
  required: f.required,
  nullable: f.nullable,
  example: f.example ?? '',
  description: f.description ?? '',
});

export const newFieldDraft = (): FieldDraft => ({
  id: newId(),
  name: '',
  type: { ...STRING_TYPE },
  required: true,
  nullable: false,
  example: '',
  description: '',
});

export const newModel = (): ApiModel => ({ id: newId(), name: '', fields: [] });

export const toModelDraft = (model: ApiModel): ModelDraft => ({
  name: model.name,
  description: model.description ?? '',
  sourceTableId: model.sourceTableId ?? '',
  fields: model.fields.map(toFieldDraft),
});

export const fromModelDraft = (model: ApiModel, draft: ModelDraft): ApiModel => ({
  id: model.id,
  name: draft.name.trim(),
  description: draft.description.trim() || undefined,
  sourceTableId: draft.sourceTableId || undefined,
  fields: draft.fields.map((f) => ({
    id: f.id,
    name: f.name.trim(),
    type: fromTypeDraft(f.type),
    required: f.required,
    nullable: f.nullable,
    example: f.example.trim() || undefined,
    description: f.description.trim() || undefined,
  })),
});

/** Fields (and a default name) generated from a table's columns */
export function draftFromTable(table: TableNode, draft: ModelDraft): ModelDraft {
  const generated = modelFromTable(table);
  return {
    ...draft,
    name: draft.name.trim() || `${generated.name}Dto`,
    sourceTableId: table.id,
    fields: generated.fields.map((f) => toFieldDraft({ ...f, id: newId() })),
  };
}

export const buildModelDoc = (model: ApiModel) => (doc: CanvasDoc, draft: ModelDraft) =>
  upsertModel(doc, fromModelDraft(model, draft));

export const modelMapper: IssueMapper = {
  node: ([key, index, field]) => {
    if (key === 'name' || key === 'description') return key;
    if (key === 'fields' && typeof index === 'number') return `fields.${index}.${field === 'type' ? 'type.base' : 'name'}`;
    return null;
  },
};
