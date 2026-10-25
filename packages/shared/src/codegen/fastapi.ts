import { defaultOperationId, type ApiSettings, type FieldType } from '../api';
import type { CanvasDoc, CanvasNode } from '../canvas';
import type { DatabaseSettings } from '../database';
import { roleText } from '../feature-scope';
import { statusText } from '../openapi';
import type { ZipEntry } from '../zip';
import type { CodegenOptions } from './options';
import { pydanticModels, type PydanticModels } from './pydantic';
import { ImportSet, importBlock, pyAttr, pyComment, pyDocstring, pyString, uniqueName } from './python';
import { toSqlAlchemy } from './sqlalchemy';

/* ============================================================
 * A runnable FastAPI app with a route stub per endpoint: path, query and header params,
 * request body, response model, status code, other responses, tags and auth as in the
 * OpenAPI export (same operationIds), plus the API models as Pydantic classes. Handlers raise
 * 501 until implemented; comments list what the endpoint calls, reads, writes and emits.
 * `toFastApi` writes one `main.py`; `fastApiPackage` the same app as a project with a router per tag.
 * ============================================================ */

type EndpointNode = Extract<CanvasNode, { type: 'endpoint' }>;
type Doc = Pick<CanvasDoc, 'nodes' | 'edges' | 'models' | 'api'>;

/** Module-level names besides the models; functions, params and classes must not shadow them */
const MODULE_NAMES = [
  'app', 'Annotated', 'Body', 'Depends', 'FastAPI', 'Header', 'HTTPException', 'Path', 'Query',
  'HTTPBearer', 'HTTPAuthorizationCredentials', 'APIKeyHeader', 'bearer_scheme', 'api_key_header',
  'CurrentUser', 'current_user', 'admin_user', 'APIRouter', 'router',
];

/** Literal paths before parameterized ones (`/orders/latest` before `/orders/{id}`), so FastAPI matches them first */
const routeKey = (e: EndpointNode) => `${e.data.path.replace(/\{[^}]*\}/g, '￿')} ${['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].indexOf(e.data.method)}`;

const PARAM_MARKER = { path: 'Path', query: 'Query', header: 'Header' } as const;

/** What the endpoint does on the canvas, from its outgoing links: "Writes orders: create, update" */
function linkComments(doc: Doc, endpoint: EndpointNode): string[] {
  const nodes = new Map<string, CanvasNode>(doc.nodes.map((n) => [n.id, n]));
  const VERB = { calls: 'Calls', reads: 'Reads', writes: 'Writes', emits: 'Emits' } as const;
  return doc.edges.flatMap((e) => {
    if (e.source !== endpoint.id || !(e.kind in VERB)) return [];
    const target = nodes.get(e.target);
    if (!target) return [];
    const ops = e.kind !== 'fk' && e.crud?.length ? `: ${e.crud.join(', ')}` : '';
    return [`${VERB[e.kind as keyof typeof VERB]} ${target.label || target.type}${ops}`];
  });
}

/** What every route of the app shares: names taken, whether routes need a user */
type App = {
  doc: Doc;
  options: CodegenOptions;
  models: PydanticModels;
  reserved: ReadonlySet<string>;
  functionNames: Set<string>;
  endpoints: EndpointNode[];
  usesAuth: boolean;
  usesAdmin: boolean;
};

/** Where a route is written: its module's imports and decorator object (`app` or `router`) */
type RouteModule = {
  stdlib: ImportSet;
  third: ImportSet;
  annotation(type: FieldType): string;
  /** An auth helper the route uses (`CurrentUser`, `current_user`, `admin_user`) */
  auth(name: string): void;
  decorator: string;
};

function appOf(doc: Doc, options: CodegenOptions, stdlib: ImportSet, third: ImportSet): App {
  const models = pydanticModels(doc, options, stdlib, third, MODULE_NAMES);
  const endpoints = doc.nodes.filter((n): n is EndpointNode => n.type === 'endpoint').sort((a, b) => (routeKey(a) < routeKey(b) ? -1 : 1));
  const usesAuth = doc.api.auth !== 'none' && endpoints.some((e) => e.data.auth !== 'public');
  return {
    doc,
    options,
    models,
    reserved: new Set([...MODULE_NAMES, ...models.names.values()]),
    functionNames: new Set(),
    endpoints,
    usesAuth,
    usesAdmin: usesAuth && endpoints.some((e) => e.data.auth === 'admin'),
  };
}

function route(app: App, endpoint: EndpointNode, mod: RouteModule): string {
  const { reserved, options } = app;
  const { stdlib, third } = mod;
  const { method, path, auth, spec } = endpoint.data;
  const operationId = spec.operationId ?? defaultOperationId(method, path);
  const fn = uniqueName(pyAttr(operationId, reserved), app.functionNames);

  // Arguments without defaults must come first
  const required: string[] = [];
  const optional: string[] = [];
  const argNames = new Set<string>();
  const marker = (kind: string, args: string[]) => {
    third.add('fastapi', kind);
    return `${kind}(${args.join(', ')})`;
  };
  for (const p of spec.params) {
    const attr = uniqueName(pyAttr(p.name, reserved), argNames);
    const isRequired = p.in === 'path' || p.required;
    const args = [...(attr !== p.name ? [`alias=${pyString(p.name)}`] : []), ...(p.description?.trim() ? [`description=${pyString(p.description.trim())}`] : [])];
    const type = mod.annotation(p.type);
    stdlib.add('typing', 'Annotated');
    const arg = `${attr}: Annotated[${isRequired ? type : `${type} | None`}, ${marker(PARAM_MARKER[p.in], args)}]`;
    if (isRequired) required.push(arg);
    else optional.push(`${arg} = None`);
  }

  const notes: string[] = [];
  if (spec.requestBody) {
    const body = spec.requestBody;
    const attr = uniqueName('body', argNames);
    let type = mod.annotation(body.type);
    if (!body.required) type = `${type} | None`;
    // A model is a JSON body by itself; other types need Body()
    if (body.type.kind !== 'ref') {
      stdlib.add('typing', 'Annotated');
      type = `Annotated[${type}, ${marker('Body', [])}]`;
    }
    if (body.required) required.push(`${attr}: ${type}`);
    else optional.push(`${attr}: ${type} = None`);
    if (!/json/i.test(body.contentType)) notes.push(`The request body is ${body.contentType}: read it with Form()/File() or Request instead of JSON`);
  }

  if (app.usesAuth && auth !== 'public') {
    stdlib.add('typing', 'Annotated');
    third.add('fastapi', 'Depends');
    const dependency = auth === 'admin' ? 'admin_user' : 'current_user';
    mod.auth('CurrentUser');
    mod.auth(dependency);
    required.push(`${uniqueName('user', argNames)}: Annotated[CurrentUser, Depends(${dependency})]`);
  }

  const success = spec.responses.find((r) => r.status.startsWith('2'));
  const others = spec.responses.filter((r) => r !== success);
  const statusCode = success && /^\d+$/.test(success.status) ? Number(success.status) : undefined;
  const returns = success?.body ? mod.annotation(success.body) : 'None';
  const responseArgs = others.map((r) => {
    const key = /^\d+$/.test(r.status) ? r.status : pyString(r.status);
    const model = r.body ? `, "model": ${mod.annotation(r.body)}` : '';
    return `${key}: {"description": ${pyString(r.description || statusText(r.status))}${model}}`;
  });

  const summary = spec.summary ?? (endpoint.label || undefined);
  const decoratorArgs = [
    pyString(path),
    ...(statusCode !== undefined && statusCode !== 200 ? [`status_code=${statusCode}`] : []),
    `operation_id=${pyString(operationId)}`,
    ...(summary ? [`summary=${pyString(summary)}`] : []),
    ...(success?.description ? [`response_description=${pyString(success.description)}`] : []),
    ...(spec.tags.length ? [`tags=[${spec.tags.map(pyString).join(', ')}]`] : []),
    ...(responseArgs.length ? [`responses={${responseArgs.join(', ')}}`] : []),
    ...(spec.deprecated ? ['deprecated=True'] : []),
  ];

  const args = [...required, ...optional];
  const signature = args.length ? `def ${fn}(\n${args.map((a) => `    ${a},`).join('\n')}\n) -> ${returns}:` : `def ${fn}() -> ${returns}:`;
  const description = spec.description ?? endpoint.notes;
  const role = options.roles?.get(`node:${endpoint.id}`);
  return [
    ...(options.featureName ? pyComment(roleText(role, options.featureName)) : []),
    `@${mod.decorator}.${method.toLowerCase()}(`,
    ...decoratorArgs.map((a) => `    ${a},`),
    ')',
    signature,
    ...(description?.trim() ? pyDocstring(description, '    ') : []),
    ...[...linkComments(app.doc, endpoint), ...notes].flatMap((c) => pyComment(c, '    ')),
    '    raise HTTPException(status_code=501, detail="Not implemented")',
  ].join('\n');
}

function appBlock(api: ApiSettings): string {
  const appArgs = [
    `title=${pyString(api.title)}`,
    `version=${pyString(api.version)}`,
    ...(api.description?.trim() ? [`description=${pyString(api.description.trim())}`] : []),
    ...(api.servers.length
      ? [`servers=[${api.servers.map((s) => `{"url": ${pyString(s.url)}${s.description ? `, "description": ${pyString(s.description)}` : ''}}`).join(', ')}]`]
      : []),
  ];
  return `app = FastAPI(\n${appArgs.map((a) => `    ${a},`).join('\n')}\n)`;
}

/** The security scheme, `CurrentUser` and the `current_user` / `admin_user` dependency stubs */
function authBlocks(app: App, stdlib: ImportSet, third: ImportSet): string[] {
  const { api } = app.doc;
  stdlib.add('typing', 'Annotated');
  third.add('fastapi', 'Depends', 'HTTPException');
  third.add('pydantic', 'BaseModel');
  const blocks: string[] = [];
  if (api.auth === 'bearer') {
    third.add('fastapi.security', 'HTTPAuthorizationCredentials', 'HTTPBearer');
    blocks.push('bearer_scheme = HTTPBearer(scheme_name="bearerAuth", bearerFormat="JWT")');
  } else {
    third.add('fastapi.security', 'APIKeyHeader');
    blocks.push(`api_key_header = APIKeyHeader(name=${pyString(api.apiKeyHeader)}, scheme_name="apiKeyAuth")`);
  }
  blocks.push(
    [
      'class CurrentUser(BaseModel):',
      '    """The signed-in caller; extend it with what your handlers need."""',
      '',
      '    id: str',
      '    roles: list[str] = []',
    ].join('\n'),
    [
      api.auth === 'bearer'
        ? 'def current_user(credentials: Annotated[HTTPAuthorizationCredentials, Depends(bearer_scheme)]) -> CurrentUser:'
        : 'def current_user(api_key: Annotated[str, Depends(api_key_header)]) -> CurrentUser:',
      api.auth === 'bearer'
        ? '    # TODO: verify the token (credentials.credentials) and load the user'
        : '    # TODO: look up the API key and load its user',
      '    raise HTTPException(status_code=401, detail="Authentication is not implemented")',
    ].join('\n'),
    ...(app.usesAdmin
      ? [
          [
            'def admin_user(user: Annotated[CurrentUser, Depends(current_user)]) -> CurrentUser:',
            '    if "admin" not in user.roles:',
            '        raise HTTPException(status_code=403, detail="Admins only")',
            '    return user',
          ].join('\n'),
        ]
      : []),
  );
  return blocks;
}

const EMAIL_NOTE = '# EmailStr needs the email extra: pip install "pydantic[email]"';

/** A module's source: header lines, imports, then blocks two blank lines apart */
const pyModule = (header: string[], imports: string[], blocks: string[]) => `${[[header.join('\n'), ...imports].join('\n\n'), ...blocks].join('\n\n\n')}\n`;

/** The doc's endpoints as a FastAPI app (Python 3.10+), with the API models it uses */
export function toFastApi(doc: Doc, options: CodegenOptions = {}): string {
  const stdlib = new ImportSet();
  const third = new ImportSet();
  third.add('fastapi', 'FastAPI', 'HTTPException');
  const app = appOf(doc, options, stdlib, third);
  const mod: RouteModule = { stdlib, third, annotation: (type) => app.models.annotation(type), auth: () => {}, decorator: 'app' };
  const routes = app.endpoints.map((e) => route(app, e, mod));
  const auth = app.usesAuth ? authBlocks(app, stdlib, third) : [];

  const header = [
    `# Generated by RuneArch: FastAPI app with a route stub per endpoint${options.featureName ? `, feature ${options.featureName}` : ''}.`,
    '# Requires Python 3.10+ and FastAPI (pip install "fastapi[standard]"). Run: fastapi dev main.py',
    '# Every handler raises 501 until implemented. The models match the Pydantic export.',
    ...(app.models.email ? [EMAIL_NOTE] : []),
  ];
  const { classes, rebuild } = app.models;
  return pyModule(header, importBlock(stdlib, third), [
    ...classes,
    ...(rebuild.length ? [rebuild.join('\n')] : []),
    appBlock(doc.api),
    ...auth,
    ...routes,
  ]);
}

/** `^/orders/[^/]+$` for `/orders/{id}`: the request paths a route matches */
const pathPattern = (path: string) =>
  new RegExp(`^${path.split(/(\{[^}]*\})/).map((part) => (/^\{.*\}$/.test(part) ? '[^/]+' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('')}$`);

/**
 * The doc's endpoints as a FastAPI project: `app/main.py` includes one router module per first
 * tag (`app/routers/<tag>.py`, untagged routes in `default.py`), which import the models from
 * `app/schemas.py` and the auth stubs from `app/auth.py`. With tables, `app/models.py` holds the
 * SQLAlchemy export. The app serves the same OpenAPI as `toFastApi`.
 */
export function fastApiPackage(doc: Doc & { database?: DatabaseSettings }, options: CodegenOptions = {}): ZipEntry[] {
  const schemaStdlib = new ImportSet();
  const schemaThird = new ImportSet();
  const app = appOf(doc, options, schemaStdlib, schemaThird);
  const feature = options.featureName ? `, feature ${options.featureName}` : '';
  const files: ZipEntry[] = [{ path: 'app/__init__.py', content: '' }];

  // One router per first tag, in route order, so literal paths still come first within each
  const groups = new Map<string, EndpointNode[]>();
  for (const e of app.endpoints) {
    const tag = e.data.spec.tags[0] ?? '';
    groups.set(tag, [...(groups.get(tag) ?? []), e]);
  }
  const moduleNames = new Set<string>(['__init__']);
  const routers = [...groups].map(([tag, endpoints]) => {
    const name = uniqueName(pyAttr(tag || 'default', new Set(['app', 'FastAPI'])), moduleNames);
    const stdlib = new ImportSet();
    const third = new ImportSet();
    const local = new ImportSet();
    third.add('fastapi', 'APIRouter', 'HTTPException');
    const models = new Set<string>();
    const mod: RouteModule = {
      stdlib,
      third,
      annotation: (type) => app.models.annotation(type, { stdlib, thirdParty: third, models }),
      auth: (helper) => local.add('..auth', helper),
      decorator: 'router',
    };
    const routes = endpoints.map((e) => route(app, e, mod));
    if (models.size) local.add('..schemas', ...models);
    const header = [`# Generated by RuneArch: the routes tagged ${tag ? pyString(tag) : '(none)'}${feature}. Every handler raises 501 until implemented.`];
    files.push({ path: `app/routers/${name}.py`, content: pyModule(header, importBlock(stdlib, third, local), ['router = APIRouter()', ...routes]) });
    return { name, endpoints };
  });
  if (routers.length) files.push({ path: 'app/routers/__init__.py', content: '' });

  // A route included earlier that matches a later router's literal path would win; say so
  const shadowed = routers.flatMap((later, j) =>
    later.endpoints.flatMap((e) =>
      routers.slice(0, j).flatMap((earlier) =>
        earlier.endpoints
          .filter((f) => f.data.method === e.data.method && f.data.path !== e.data.path && /\{/.test(f.data.path) && routeKey(e) < routeKey(f))
          .filter((f) => pathPattern(f.data.path).test(e.data.path))
          .map((f) => `${f.data.method} ${f.data.path} (${earlier.name}) is included before ${e.data.path} (${later.name}) and matches it first.`),
      ),
    ),
  );

  const mainThird = new ImportSet();
  mainThird.add('fastapi', 'FastAPI');
  const mainLocal = new ImportSet();
  if (routers.length) mainLocal.add('.routers', ...routers.map((r) => r.name));
  const includes = [
    ...shadowed.flatMap((s) => pyComment(`Note: ${s} Move the route to the other router or reorder these lines.`)),
    ...routers.map((r) => `app.include_router(${r.name}.router)`),
  ];
  files.push({
    path: 'app/main.py',
    content: pyModule(
      [
        `# Generated by RuneArch: FastAPI app${feature}, with a router per tag in app/routers.`,
        '# Requires Python 3.10+. Install: pip install -r requirements.txt. Run: fastapi dev app/main.py',
      ],
      importBlock(new ImportSet(), mainThird, mainLocal),
      [appBlock(doc.api), ...(includes.length ? [includes.join('\n')] : [])],
    ),
  });

  if (doc.models.length) {
    const { classes, rebuild, email } = app.models;
    const header = [`# Generated by RuneArch: the API models as Pydantic v2 classes${feature}.`, ...(email ? [EMAIL_NOTE] : [])];
    files.push({ path: 'app/schemas.py', content: pyModule(header, importBlock(schemaStdlib, schemaThird), [...classes, ...(rebuild.length ? [rebuild.join('\n')] : [])]) });
  }

  if (app.usesAuth) {
    const stdlib = new ImportSet();
    const third = new ImportSet();
    const blocks = authBlocks(app, stdlib, third);
    const header = ['# Generated by RuneArch: authentication stubs. current_user raises 401 until it checks credentials.'];
    files.push({ path: 'app/auth.py', content: pyModule(header, importBlock(stdlib, third), blocks) });
  }

  const hasTables = doc.nodes.some((n) => n.type === 'table');
  if (hasTables) files.push({ path: 'app/models.py', content: toSqlAlchemy(doc, options) });

  const requirements = ['fastapi[standard]', ...(app.models.email ? ['pydantic[email]'] : []), ...(hasTables ? ['sqlalchemy>=2.0'] : [])];
  files.push({ path: 'requirements.txt', content: `${requirements.join('\n')}\n` });

  const layout = [
    '- `app/main.py`: the app; includes the routers',
    ...routers.map((r) => `- \`app/routers/${r.name}.py\`: ${r.endpoints.length} ${r.endpoints.length === 1 ? 'route' : 'routes'}`),
    ...(doc.models.length ? ['- `app/schemas.py`: the API models (Pydantic)'] : []),
    ...(app.usesAuth ? ['- `app/auth.py`: the security scheme and `current_user` / `admin_user` stubs'] : []),
    ...(hasTables ? ['- `app/models.py`: the tables as SQLAlchemy 2.0 ORM classes (not wired to the routes)'] : []),
  ];
  files.push({
    path: 'README.md',
    content: [
      `# ${doc.api.title}`,
      '',
      `Generated by RuneArch${feature}. Every route handler raises 501 until implemented.`,
      '',
      '## Layout',
      '',
      ...layout,
      '',
      '## Run',
      '',
      '```sh',
      'pip install -r requirements.txt',
      'fastapi dev app/main.py',
      '```',
      '',
      'Then open http://127.0.0.1:8000/docs.',
      '',
    ].join('\n'),
  });

  return files.sort((a, b) => (a.path < b.path ? -1 : 1));
}
