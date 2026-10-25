import { modelRefOf, type ApiModel, type Field, type FieldType, type PrimitiveType } from '../api';
import type { CanvasDoc } from '../canvas';
import { roleText } from '../feature-scope';
import type { CodegenOptions } from './options';
import { dependencyOrder } from './order';
import { ImportSet, importBlock, pyAttr, pyClass, pyComment, pyDocstring, pyLiteral, pyString, uniqueName } from './python';

/* ============================================================
 * Pydantic v2 models from the API models (DTOs), e.g. for FastAPI request and response bodies.
 * Field names become snake_case attributes with the API name as alias, so JSON keeps the
 * names of the OpenAPI spec. Models come after the models they use; references to later
 * models (cycles) are quoted and resolved by `model_rebuild()` at the end.
 * ============================================================ */

/** Names the module imports or Python builtins the annotations use; attributes must not shadow them */
const TYPE_NAMES = ['str', 'int', 'float', 'bool', 'list', 'date', 'datetime', 'UUID', 'Literal', 'AnyUrl', 'EmailStr', 'BaseModel', 'ConfigDict', 'Field'];

/** BaseModel members a field must not shadow */
const BASE_MODEL_MEMBERS = ['copy', 'dict', 'json', 'schema', 'schema_json', 'construct', 'validate', 'fields', 'from_orm', 'parse_obj', 'parse_raw', 'parse_file', 'update_forward_refs'];

type Ctx = { names: Map<string, string>; stdlib: ImportSet; pydantic: ImportSet; email: boolean; refs?: Set<string> };

/** `Literal["a", "b"]`; numeric enum values stay numbers on number types */
function literal(type: PrimitiveType): string {
  const values = type.enum!.map((v) => (type.type !== 'string' && /^-?\d+(\.\d+)?$/.test(v) ? v : pyString(v)));
  return `Literal[${values.join(', ')}]`;
}

function primitive(type: PrimitiveType, ctx: Ctx): string {
  if (type.enum?.length) {
    ctx.stdlib.add('typing', 'Literal');
    return literal(type);
  }
  switch (type.type) {
    case 'integer':
      return 'int';
    case 'number':
      return 'float';
    case 'boolean':
      return 'bool';
  }
  switch (type.format) {
    case 'uuid':
      ctx.stdlib.add('uuid', 'UUID');
      return 'UUID';
    case 'email':
      ctx.pydantic.add('pydantic', 'EmailStr');
      ctx.email = true;
      return 'EmailStr';
    case 'uri':
      ctx.pydantic.add('pydantic', 'AnyUrl');
      return 'AnyUrl';
    case 'date':
      ctx.stdlib.add('datetime', 'date');
      return 'date';
    case 'date-time':
      ctx.stdlib.add('datetime', 'datetime');
      return 'datetime';
    default:
      return 'str';
  }
}

function annotation(type: FieldType, ctx: Ctx): string {
  switch (type.kind) {
    case 'primitive':
      return primitive(type, ctx);
    case 'ref': {
      // Saved docs only reference existing models
      const name = ctx.names.get(type.modelId)!;
      ctx.refs?.add(name);
      return name;
    }
    case 'array':
      return `list[${annotation(type.items, ctx)}]`;
  }
}

/** The example as the field's type reads it: strings as written, other types as JSON (like the OpenAPI export) */
function example(f: Field): string | undefined {
  if (f.example === undefined) return undefined;
  if (f.type.kind === 'primitive' && f.type.type === 'string') return pyString(f.example);
  try {
    return pyLiteral(JSON.parse(f.example));
  } catch {
    return pyString(f.example);
  }
}

function modelClass(model: ApiModel, ctx: Ctx, defined: Set<string>, options: CodegenOptions): { lines: string[]; forward: boolean } {
  const name = ctx.names.get(model.id)!;
  const reserved = new Set([...TYPE_NAMES, ...BASE_MODEL_MEMBERS, ...ctx.names.values()]);
  const used = new Set<string>();
  let aliased = false;
  let protectedName = false;
  let forward = false;

  const body = model.fields.map((f) => {
    const attr = uniqueName(pyAttr(f.name, reserved), used);
    // A model defined later (or this one) is only known once the module has run
    const ref = modelRefOf(f.type);
    const isForward = ref !== undefined && ctx.names.has(ref) && !defined.has(ref);
    forward ||= isForward;
    let type = annotation(f.type, ctx);
    if (f.nullable || !f.required) type = `${type} | None`;
    if (isForward) type = pyString(type);

    const args = [
      ...(f.required ? [] : ['default=None']),
      ...(attr !== f.name ? [`alias=${pyString(f.name)}`] : []),
      ...(f.description?.trim() ? [`description=${pyString(f.description.trim())}`] : []),
      ...(example(f) !== undefined ? [`examples=[${example(f)}]`] : []),
    ];
    aliased ||= attr !== f.name;
    protectedName ||= attr.startsWith('model_');
    if (args.length === 0) return `    ${attr}: ${type}`;
    if (args.length === 1 && args[0] === 'default=None') return `    ${attr}: ${type} = None`;
    ctx.pydantic.add('pydantic', 'Field');
    return `    ${attr}: ${type} = Field(${args.join(', ')})`;
  });

  const config = [
    // Accept the attribute names too, e.g. `OrderDto(customer_id=...)`
    ...(aliased ? ['populate_by_name=True'] : []),
    // Pydantic reserves the `model_` prefix unless told otherwise
    ...(protectedName ? ['protected_namespaces=()'] : []),
  ];
  if (config.length) ctx.pydantic.add('pydantic', 'ConfigDict');

  const role = options.roles?.get(`model:${model.id}`);
  const lines = [
    ...(options.featureName ? pyComment(roleText(role, options.featureName)) : []),
    `class ${name}(BaseModel):`,
    ...(model.description?.trim() ? pyDocstring(model.description, '    ') : []),
    ...(config.length ? [`    model_config = ConfigDict(${config.join(', ')})`] : []),
    ...(config.length && body.length ? [''] : []),
    ...body,
  ];
  if (lines.at(-1)!.endsWith(':')) lines.push('    pass');
  return { lines, forward };
}

export type PydanticModels = {
  /** Class definitions, models used by others first */
  classes: string[];
  /** `Model.model_rebuild()` lines for models that refer to later ones */
  rebuild: string[];
  /** Whether `EmailStr` is used (needs `pydantic[email]`) */
  email: boolean;
  /** Model id → class name */
  names: ReadonlyMap<string, string>;
  /**
   * A field or param type as a Python annotation; adds its imports. For another module (e.g. a
   * FastAPI router), `imports` takes that module's import sets and collects the model classes it names.
   */
  annotation(type: FieldType, imports?: AnnotationImports): string;
};

export type AnnotationImports = { stdlib: ImportSet; thirdParty: ImportSet; models: Set<string> };

/**
 * The doc's API models as Pydantic classes, adding their imports to `stdlib` and `thirdParty`.
 * `reserved` class names (e.g. a module's own helpers) are avoided. Shared by the Pydantic and FastAPI exports.
 */
export function pydanticModels(
  doc: Pick<CanvasDoc, 'models'>,
  options: CodegenOptions,
  stdlib: ImportSet,
  thirdParty: ImportSet,
  reserved: readonly string[] = [],
): PydanticModels {
  const used = new Set<string>();
  const taken = new Set([...TYPE_NAMES, ...reserved]);
  const ctx: Ctx = {
    names: new Map(doc.models.map((m) => [m.id, uniqueName(pyClass(m.name, taken), used)])),
    stdlib,
    pydantic: thirdParty,
    email: false,
  };
  if (doc.models.length) ctx.pydantic.add('pydantic', 'BaseModel');

  const defined = new Set<string>();
  const rebuild: string[] = [];
  const classes = dependencyOrder(doc.models).map((m) => {
    const { lines, forward } = modelClass(m, ctx, defined, options);
    defined.add(m.id);
    if (forward) rebuild.push(`${ctx.names.get(m.id)!}.model_rebuild()`);
    return lines.join('\n');
  });
  return {
    classes,
    rebuild,
    email: ctx.email,
    names: ctx.names,
    annotation: (type, imports) =>
      annotation(type, imports ? { ...ctx, stdlib: imports.stdlib, pydantic: imports.thirdParty, refs: imports.models } : ctx),
  };
}

/** The doc's API models as Pydantic v2 classes (Python 3.10+) */
export function toPydantic(doc: Pick<CanvasDoc, 'models'>, options: CodegenOptions = {}): string {
  const stdlib = new ImportSet();
  const pydantic = new ImportSet();
  pydantic.add('pydantic', 'BaseModel');
  const { classes, rebuild, email } = pydanticModels(doc, options, stdlib, pydantic);

  const header = [
    `# Generated by RuneArch: Pydantic v2 models for the API models${options.featureName ? ` of feature ${options.featureName}` : ''}.`,
    '# Requires Python 3.10+ and pydantic>=2.',
    ...(email ? ['# EmailStr needs the email extra: pip install "pydantic[email]"'] : []),
  ].join('\n');

  const top = [header, ...importBlock(stdlib, pydantic)].join('\n\n');
  return `${[top, ...classes, ...(rebuild.length ? [rebuild.join('\n')] : [])].join('\n\n\n')}\n`;
}
