import type { ApiModel } from '@flowcanvas/shared';
import type { FieldPath, FieldValues, UseFormRegister } from 'react-hook-form';
import { FORMATS, PRIMITIVES, modelBase, primitiveBase, type TypeDraft } from '../dialogs/typeDraft';
import { checkboxClass, compactControlClass } from './ui/form';

type Props<T extends FieldValues> = {
  /** Form path of a TypeDraft, e.g. `fields.2.type` */
  name: string;
  value: TypeDraft | undefined;
  register: UseFormRegister<T>;
  models: readonly ApiModel[];
  /** Params: primitives only, no lists */
  primitiveOnly?: boolean;
  label: string;
  invalid?: boolean;
};

const cell = `${compactControlClass} font-mono`;

/** Primitive (+ format, enum) or model reference, optionally as a list */
export function TypePicker<T extends FieldValues>({ name, value, register, models, primitiveOnly, label, invalid }: Props<T>) {
  const field = (part: keyof TypeDraft) => register(`${name}.${part}` as FieldPath<T>);
  const primitive = PRIMITIVES.find((p) => value?.base === primitiveBase(p));
  const formats = primitive ? FORMATS[primitive] : [];

  return (
    <div className="flex flex-wrap items-center gap-1">
      <select {...field('base')} aria-label={label} aria-invalid={invalid || undefined} className={`${cell} min-w-24`}>
        <optgroup label="Primitive">
          {PRIMITIVES.map((p) => (
            <option key={p} value={primitiveBase(p)}>
              {p}
            </option>
          ))}
        </optgroup>
        {!primitiveOnly && models.length > 0 && (
          <optgroup label="Model">
            {models.map((m) => (
              <option key={m.id} value={modelBase(m.id)}>
                {m.name}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      {formats.length > 0 && (
        <select {...field('format')} aria-label={`${label} format`} className={cell}>
          <option value="">no format</option>
          {formats.map((f) => (
            <option key={f}>{f}</option>
          ))}
        </select>
      )}
      {primitive === 'string' && (
        <input {...field('enumValues')} aria-label={`${label} enum values`} placeholder="enum: a, b" className={`${cell} w-28`} />
      )}
      {!primitiveOnly && (
        <label className="flex items-center gap-1 text-xs text-text-muted">
          <input type="checkbox" {...field('list')} className={checkboxClass} />
          list
        </label>
      )}
    </div>
  );
}
