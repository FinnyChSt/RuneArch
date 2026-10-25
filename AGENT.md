# AGENT.md

Guidance for AI coding agents (and humans) working in this repository. Read this first, then
[ARCHITECTURE.md](ARCHITECTURE.md) for the why behind the structure.

## What this is

**RuneArch** is a visual system-design canvas. A user draws screens, components, endpoints, services,
jobs and database tables on one canvas, connects them, records **flows** through them and groups work
into **features**. Because everything on the canvas is structured data, the app generates real
artifacts from it: OpenAPI specs, SQL/DBML/Mermaid schemas, Pydantic/SQLAlchemy/SQLModel/FastAPI/Zod/
Drizzle/Prisma code, screen specs, feature briefs and migrations, and SVG/Mermaid/JSON exports.

The internal package scope is still `flowcanvas` (`@flowcanvas/shared`, DB name `flowcanvas`, the
`"format": "flowcanvas"` file marker). Don't rename it as a side effect of other work.

## Repository layout

pnpm monorepo, TypeScript everywhere, Node >= 24.

| Path | What | Stack |
| --- | --- | --- |
| `packages/shared` | **Domain core.** The `CanvasDoc` Zod schema, REST contract, every exporter/importer/code generator. Pure functions, no I/O. | Zod 4, tsdown |
| `apps/api` | REST API: projects, membership, canvas load/save (optimistic locking), snapshots, export endpoints. | NestJS 12, Drizzle ORM, Postgres 16 |
| `apps/web` | The editor SPA. | React 19, Vite 8, React Flow (`@xyflow/react`), Zustand + zundo, TanStack Query, React Hook Form, Tailwind 4, CodeMirror |
| `e2e` | Browser tests against the real web app + API + a throwaway database. | Playwright |

## Commands

Run from the repo root unless noted.

```sh
docker compose up -d            # Postgres on :5432 (user/pass/db: flowcanvas)
pnpm install                    # postinstall builds packages/shared
cp apps/api/.env.example apps/api/.env
pnpm --filter api db:migrate    # apply migrations
pnpm --filter api db:seed       # create the dev user (required: auth is a stub)
pnpm dev                        # shared (watch) + api :3000 + web :5173 (proxies /api)

pnpm typecheck                  # builds shared, then tsc in every package
pnpm lint                       # eslint .
pnpm test                       # builds shared, then vitest in every package
pnpm e2e                        # Playwright (needs Postgres; uses ports 3100/5174 and <db>_e2e)

pnpm --filter @flowcanvas/shared test -- feature-diff   # one package, filtered
pnpm --filter api db:generate   # new migration after editing apps/api/src/db/schema.ts
docker compose --profile app up --build      # full stack in containers, web on :8080
```

CI (`.github/workflows/ci.yml`) runs `typecheck`, `lint`, `test` against a Postgres service. Run all
three before calling a change done.

- **API tests need Postgres.** `apps/api/test/global-setup.ts` creates and migrates `<db>_test` next to the
  dev database; test files run serially and truncate tables between cases.
- The web app consumes `@flowcanvas/shared` from **source** (the `source` export condition), so shared
  edits hot-reload in the browser. The API consumes the **built** `dist/`, so rebuild shared
  (`pnpm --filter @flowcanvas/shared build`, or keep `pnpm dev` running) before testing API changes.

## Core rules

These are the invariants the codebase is built around. Breaking one usually breaks something far away.

1. **`CanvasDoc` is the single source of truth.** One JSON document per project
   (`packages/shared/src/canvas.ts`), saved whole. React Flow state is *derived* from it
   (`apps/web/src/canvas/mapping.ts`); never store canvas data in React Flow or component state.
2. **Every valid doc must produce valid output.** Integrity rules live in `CanvasDoc.superRefine`
   (unique ids/routes/operationIds/table names, edges pointing at real nodes/columns, resolvable model refs,
   flow continuity, feature structure). If an exporter could fail on some input, add a schema rule
   instead of a runtime special case. The same schema validates on the client and server.
3. **Doc transforms are pure.** `apps/web/src/store/docOps.ts`, `layoutOps.ts`, `featureOps.ts` and the
   `feature-*.ts` modules in shared take a doc and return a new doc (or the *same* reference if nothing
   changed). Keep it that way: identity checks drive undo history and dirty tracking.
4. **One user action = one `commit`** in `canvasStore`. Each commit is one undo step (zundo, limit 200)
   and marks the doc dirty for autosave. Transient view state (drag positions, measured sizes, resize
   sizes, viewport) stays out of `doc`.
5. **Shared contract, both ends.** Request/response shapes are Zod schemas in
   `packages/shared/src/http.ts`. The API validates with `ZodValidationPipe`; the web client parses
   responses with the same schemas. Change the schema, not just one side.
6. **Exports are registries.** `CODE_EXPORTS`/`CODE_PACKAGES` (`codegen/index.ts`), `SCHEMA_EXPORTS`,
   `SCREEN_EXPORTS`, `CANVAS_EXPORTS`, `FEATURE_EXPORTS`. Both the web dialogs and the API endpoints are
   driven by them, so a new format is one registry entry plus tests; the controllers stay generic.
7. **Shared has no I/O and no framework.** No Node APIs, no DOM, no Nest, no React in
   `packages/shared/src` (it builds with `platform: 'neutral'`).

## Making common changes

**Add a field to a node / the doc**
1. Extend the Zod schema in `packages/shared/src/canvas.ts` with a `.default(...)` so existing stored docs
   still parse. Add integrity rules to `superRefine` if needed.
2. Update `emptyCanvas()` if it's a doc-level field.
3. Update exporters that should reflect it, plus their tests in `packages/shared/test/`.
4. Web: node renderer in `apps/web/src/canvas/nodes/`, dialog in `apps/web/src/dialogs/` (+ its
   `*Draft.ts`), and `nodeFactory.ts` defaults.
5. A breaking doc change needs a `schemaVersion` bump and a migration in `parseCanvasFile`
   (`canvas-export.ts`) and the API load path. None exists yet; avoid if a default will do.

**Add a code generator / export format** — implement a pure `render(doc, options)` in shared, register it,
add a test (use `packages/shared/test/fixtures/kitchen-sink.ts`), and add an API e2e case in
`apps/api/test/*-export.e2e.spec.ts`.

**Add an API endpoint** — new Nest module under `apps/api/src/<area>/`, register it in `app.module.ts`.
Project-scoped routes use `@UseGuards(ProjectAccessGuard)` and `@RequireRole('editor' | 'owner')` for
writes. Validate bodies with `new ZodValidationPipe(SharedSchema)`. Add the shape to `http.ts` and a
client function to `apps/web/src/api/client.ts`.

**Change the database schema** — edit `apps/api/src/db/schema.ts`, run `pnpm --filter api db:generate`,
commit the generated SQL and `meta/` files. Never hand-edit applied migrations.

## Conventions

- **Imports:** the API is NodeNext ESM, so relative imports end in `.js` (`'./canvas.service.js'`). The
  web app and shared use bundler resolution without extensions.
- **Style:** 2-space indent, single quotes, semicolons, wide lines (~120–140 chars). Match the file
  you're in.
- **Comments:** short JSDoc `/** … */` on exported functions and non-obvious fields, explaining *why* or
  the contract (e.g. "returns the same doc if nothing changed"). Section banners
  (`/* ===== … ===== */`) in large shared modules. Don't narrate obvious code.
- **Naming:** Zod schema and its inferred type share a name (`export const Flow = z.object(...)`,
  `export type Flow = z.infer<typeof Flow>`). Registries are `SCREAMING_CASE`; lookups are
  `xByName`/`xByExtension` returning `undefined` for unknown keys (`Object.hasOwn`, never bare indexing).
- **Errors:** Zod errors become `400 { issues: [{ path, message }] }` via `HttpExceptionFilter`; the web
  app maps issue paths back to nodes to highlight them. Non-members get **404**, not 403, so project ids
  can't be probed. Stale saves get **409 `{ currentVersion }`**.
- **User-facing copy:** plain sentences, sentence case, no jargon ("Someone else saved this canvas since
  you loaded it.").
- **Tests:** colocated `*.test.ts(x)` in web (Vitest + jsdom + Testing Library), `packages/shared/test/`
  for shared, `apps/api/test/*.e2e.spec.ts` for API (supertest against the full Nest app, with
  `TestAuthGuard` to switch users). Test the pure function where possible; reach for component tests
  for interaction.

## Gotchas

- **Auth is a stub.** `DevAuthGuard` makes every request act as `dev@flowcanvas.local`. Missing seed ⇒
  every request 503s with a hint. Real auth (JWT) is planned; keep authorization logic in
  `ProjectAccessGuard` so it survives the swap.
- **Body limit is 5 MB** (Nest and nginx). The unload save uses `fetch(..., { keepalive: true })`,
  which browsers cap at 64 KB, so large docs skip it (`saveCanvasOnUnload`).
- **Nest needs decorator metadata**, which `tsx` doesn't emit. Run the API via `nest start`/`nest build`,
  not `tsx src/main.ts`. (`tsx` is fine for the seed and migration scripts.)
- **Frames come first in `doc.nodes`** (React Flow needs parents before children); children's positions
  are relative to their frame; frames don't nest.
- **Viewport is kept outside `doc`** in the store and merged in only when saving, so panning never
  creates undo steps or saves.
- Table/column names compare case-insensitively (like unquoted SQL identifiers).
- Code comments reference `docs/feature-scopes-plan.md` and `docs/openapi-import-plan.md`, which are not
  in the repo. Treat the code and tests as the spec for those areas.

## Before you finish

- [ ] `pnpm typecheck && pnpm lint && pnpm test` pass (Postgres running for API tests).
- [ ] New doc fields have defaults; new rules are in `superRefine` with tests.
- [ ] Shared contract changed on both ends (API pipe + web client parse).
- [ ] Migrations generated and committed if `schema.ts` changed.
- [ ] Update this file or ARCHITECTURE.md if you changed a rule they describe.
