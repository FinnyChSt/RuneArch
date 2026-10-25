import { describe, expect, it } from 'vitest';
import {
  CanvasDoc,
  CODE_EXPORTS,
  codeExportByTarget,
  convertDocDialect,
  emptyCanvas,
  scopeToFeature,
  toDrizzle,
  toFastApi,
  toPrisma,
  toPydantic,
  toSqlAlchemy,
  toSqlModel,
  toZod,
} from '../src';
import { pySnake } from '../src/codegen/python';

const at = { x: 0, y: 0 };
const str = { kind: 'primitive', type: 'string' } as const;
const col = (id: string, name: string, type: string, extra: object = {}) => ({ id, name, type, ...extra });

const parse = (input: Record<string, unknown>) => CanvasDoc.parse({ ...emptyCanvas(), ...input });

const models = [
  {
    id: 'order',
    name: 'OrderDto',
    description: 'An order',
    fields: [
      { id: 'o1', name: 'id', type: { ...str, format: 'uuid' } },
      { id: 'o2', name: 'customerEmail', type: { ...str, format: 'email' }, example: 'a@b.co' },
      { id: 'o3', name: 'status', type: { ...str, enum: ['draft', 'paid'] } },
      { id: 'o4', name: 'items', type: { kind: 'array', items: { kind: 'ref', modelId: 'item' } } },
      { id: 'o5', name: 'total', type: { kind: 'primitive', type: 'number' }, example: '12.5', description: 'Gross "total"' },
      { id: 'o6', name: 'note', type: str, required: false },
      { id: 'o7', name: 'paidAt', type: { ...str, format: 'date-time' }, nullable: true },
      { id: 'o8', name: 'class', type: { kind: 'primitive', type: 'integer' } },
      { id: 'o9', name: 'json', type: { kind: 'primitive', type: 'boolean' } },
      { id: 'o10', name: 'date', type: { ...str, format: 'date' } },
    ],
  },
  // Refers back to OrderDto, which needs it first: a cycle
  {
    id: 'item',
    name: 'OrderItemDto',
    fields: [
      { id: 'i1', name: 'sku', type: str },
      { id: 'i2', name: 'order', type: { kind: 'ref', modelId: 'order' }, required: false },
    ],
  },
  { id: 'empty', name: 'Empty', fields: [] },
];

const tables = [
  {
    id: 'users',
    type: 'table',
    label: 'users',
    notes: 'People who\ncan sign in',
    position: at,
    data: {
      columns: [
        col('u1', 'id', 'uuid', { primaryKey: true, default: 'gen_random_uuid()' }),
        col('u2', 'email', 'text', { nullable: false, unique: true, note: "User's login" }),
        col('u3', 'status', 'varchar(20)', { default: "'active'" }),
        col('u4', 'created at', 'timestamp with time zone', { default: 'now()' }),
        col('u5', 'balance', 'numeric(10,2)', { default: '0' }),
        col('u6', 'date', 'date'),
        col('u7', 'tags', 'text[]'),
        col('u8', 'ip', 'inet'),
        col('u9', 'metadata', 'jsonb'),
      ],
      indexes: [
        { id: 'x1', name: 'users_status', columnIds: ['u3', 'u5'] },
        { id: 'x2', columnIds: ['u6'], unique: true },
      ],
    },
  },
  {
    id: 'orders',
    type: 'table',
    label: 'orders',
    position: at,
    data: {
      schema: 'shop',
      columns: [
        col('o1', 'id', 'bigserial', { primaryKey: true }),
        col('o2', 'user_id', 'uuid', { nullable: false }),
        col('o3', 'billing_address_id', 'bigint'),
        col('o4', 'shipping_address_id', 'bigint'),
      ],
    },
  },
  { id: 'addresses', type: 'table', label: 'addresses', position: at, data: { columns: [col('a1', 'id', 'bigint', { primaryKey: true })] } },
  {
    id: 'categories',
    type: 'table',
    label: 'categories',
    position: at,
    data: { columns: [col('c1', 'id', 'integer', { primaryKey: true }), col('c2', 'parent_id', 'integer')] },
  },
  {
    id: 'profiles',
    type: 'table',
    label: 'profiles',
    position: at,
    data: { columns: [col('p1', 'user_id', 'uuid', { primaryKey: true }), col('p2', 'locale', 'text', { primaryKey: true })] },
  },
];

const fk = (id: string, source: string, target: string, sourceColumnId: string, targetColumnId: string, extra: object = {}) => ({
  id,
  kind: 'fk',
  source,
  target,
  data: { sourceColumnId, targetColumnId, ...extra },
});

const edges = [
  fk('f1', 'orders', 'users', 'o2', 'u1', { onDelete: 'cascade' }),
  fk('f2', 'orders', 'addresses', 'o3', 'a1'),
  fk('f3', 'orders', 'addresses', 'o4', 'a1'),
  fk('f4', 'categories', 'categories', 'c2', 'c1'),
  fk('f5', 'profiles', 'users', 'p1', 'u1', { cardinality: '1:1' }),
];

const doc = () => parse({ nodes: tables, edges, models });

describe('pySnake', () => {
  it.each([
    ['orderId', 'order_id'],
    ['created at', 'created_at'],
    ['HTTPStatus', 'http_status'],
    ['already_snake', 'already_snake'],
    ['_private', 'private'],
  ])('%s → %s', (name, snake) => expect(pySnake(name)).toBe(snake));
});

describe('Pydantic', () => {
  const py = () => toPydantic(doc());

  it('imports what the fields use, standard library first', () => {
    expect(py()).toContain(
      [
        'from datetime import date, datetime',
        'from typing import Literal',
        'from uuid import UUID',
        '',
        'from pydantic import BaseModel, ConfigDict, EmailStr, Field',
      ].join('\n'),
    );
    expect(py()).toContain('pip install "pydantic[email]"');
  });

  it('maps field types, optional and nullable fields', () => {
    const out = py();
    expect(out).toContain('    id: UUID\n');
    expect(out).toContain('    status: Literal["draft", "paid"]\n');
    expect(out).toContain('    items: list[OrderItemDto]\n');
    // Not required: may be left out; nullable but required: must be sent, may be null
    expect(out).toContain('    note: str | None = None\n');
    expect(out).toContain('    paid_at: datetime | None = Field(alias="paidAt")\n');
  });

  it('keeps API names as aliases for snake_case, keyword and shadowing attributes', () => {
    const out = py();
    expect(out).toContain('    customer_email: EmailStr = Field(alias="customerEmail", examples=["a@b.co"])\n');
    expect(out).toContain('    class_: int = Field(alias="class")\n');
    expect(out).toContain('    json_: bool = Field(alias="json")\n');
    expect(out).toContain('    date_: date = Field(alias="date")\n');
    expect(out).toContain('    model_config = ConfigDict(populate_by_name=True)\n');
  });

  it('adds descriptions, typed examples and docstrings', () => {
    expect(py()).toContain('    total: float = Field(description="Gross \\"total\\"", examples=[12.5])\n');
    expect(py()).toContain('class OrderDto(BaseModel):\n    """An order"""\n');
  });

  it('defines used models first and quotes references to later ones', () => {
    const out = py();
    expect(out.indexOf('class OrderItemDto')).toBeLessThan(out.indexOf('class OrderDto'));
    expect(out).toContain('    order: "OrderDto | None" = None\n');
    expect(out.trimEnd().endsWith('OrderItemDto.model_rebuild()')).toBe(true);
  });

  it('gives empty models a body and renames classes that shadow imports', () => {
    expect(py()).toContain('class Empty(BaseModel):\n    pass\n');
    const out = toPydantic(parse({ models: [{ id: 'm', name: 'Field', fields: [{ id: 'f', name: 'model_kind', type: str }] }] }));
    expect(out).toContain('class Field_(BaseModel):');
    // Pydantic reserves model_*
    expect(out).toContain('    model_config = ConfigDict(protected_namespaces=())\n');
  });

  it('marks each model with its role in a feature', () => {
    const d = parse({
      models,
      features: [{ id: 'f', name: 'Checkout', status: 'in-progress', items: [{ ref: { kind: 'model', id: 'item' }, role: 'added' }] }],
    });
    const scoped = scopeToFeature(d, 'f')!;
    const out = toPydantic(scoped.doc, scoped);
    expect(out).toContain('feature Checkout');
    expect(out).toContain('# new in Checkout\nclass OrderItemDto(BaseModel):');
    expect(out).toContain('# existing\nclass OrderDto(BaseModel):');
  });
});

describe('SQLAlchemy', () => {
  const py = () => toSqlAlchemy(doc());
  const classBody = (out: string, name: string) => out.slice(out.indexOf(`class ${name}(Base):`)).split('\n\n\nclass')[0]!;

  it('starts with postponed annotations and declares a Base', () => {
    const out = py();
    expect(out).toContain('ORM models for PostgreSQL');
    expect(out).toContain('\n\nfrom __future__ import annotations\n\n');
    expect(out).toContain('from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship');
    expect(out).toContain('class Base(DeclarativeBase):\n    pass');
  });

  it('maps columns to typed mapped columns', () => {
    const users = classBody(py(), 'User');
    expect(users).toContain('    """People who\n    can sign in\n    """');
    expect(users).toContain('    __tablename__ = "users"');
    expect(users).toContain('    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, server_default=text("gen_random_uuid()"))');
    expect(users).toContain('    email: Mapped[str] = mapped_column(Text, unique=True, comment="User\'s login")');
    expect(users).toContain('    status: Mapped[str | None] = mapped_column(String(20), server_default="active")');
    expect(users).toContain(
      '    created_at: Mapped[datetime | None] = mapped_column("created at", DateTime(timezone=True), server_default=text("now()"))',
    );
    expect(users).toContain('    balance: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), server_default=text("0"))');
    expect(users).toContain('    date_: Mapped[date | None] = mapped_column("date", Date)');
    expect(users).toContain('    tags: Mapped[list[str] | None] = mapped_column(ARRAY(Text))');
    expect(users).toContain('    # inet: no SQLAlchemy type, mapped as Text\n    ip: Mapped[str | None] = mapped_column(Text)');
    expect(users).toContain('    metadata_: Mapped[Any | None] = mapped_column("metadata", JSONB)');
  });

  it('names indexes like the SQL export and lists their columns by name', () => {
    expect(classBody(py(), 'User')).toContain(
      '    __table_args__ = (\n        Index("users_status", "status", "balance"),\n        Index("users_date_idx", "date", unique=True),\n    )',
    );
  });

  it('keys auto-increment off the column type', () => {
    expect(classBody(py(), 'Order')).toContain('    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)\n');
    expect(classBody(py(), 'Address')).toContain('    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=False)\n');
  });

  it('puts foreign keys on columns and a relationship on both sides', () => {
    const out = py();
    const orders = classBody(out, 'Order');
    expect(orders).toContain('    __table_args__ = {"schema": "shop"}');
    expect(orders).toContain('    user_id: Mapped[UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"))');
    expect(orders).toContain('    user: Mapped[User] = relationship(back_populates="orders")');
    expect(classBody(out, 'User')).toContain('    orders: Mapped[list[Order]] = relationship(back_populates="user", passive_deletes=True)');
  });

  it('tells apart two foreign keys to the same table', () => {
    const out = py();
    expect(classBody(out, 'Order')).toContain(
      '    billing_address: Mapped[Address | None] = relationship(back_populates="billing_address_orders", foreign_keys="Order.billing_address_id")',
    );
    expect(classBody(out, 'Address')).toContain(
      '    shipping_address_orders: Mapped[list[Order]] = relationship(back_populates="shipping_address", foreign_keys="Order.shipping_address_id")',
    );
  });

  it('handles self references and one-to-one links', () => {
    const out = py();
    expect(classBody(out, 'Category')).toContain(
      '    parent: Mapped[Category | None] = relationship(back_populates="categories", remote_side="Category.id")',
    );
    expect(classBody(out, 'Category')).toContain('    categories: Mapped[list[Category]] = relationship(back_populates="parent")');
    expect(classBody(out, 'User')).toContain('    profile: Mapped[Profile | None] = relationship(back_populates="user")');
    expect(classBody(out, 'Profile')).toContain('    user_id: Mapped[UUID] = mapped_column(Uuid, ForeignKey("users.id"), primary_key=True)');
  });

  it('follows the project dialect: schema prefixes, arrays as JSON', () => {
    const out = toSqlAlchemy(convertDocDialect(doc(), 'mysql'));
    expect(out).toContain('ORM models for MySQL');
    expect(classBody(out, 'Order')).toContain('    __tablename__ = "shop_orders"');
    expect(classBody(out, 'Order')).not.toContain('schema');
    expect(classBody(out, 'User')).toContain('    id: Mapped[str] = mapped_column(CHAR(36), primary_key=True, server_default=text("(uuid())"))');
    expect(classBody(out, 'User')).toContain('    tags: Mapped[Any | None] = mapped_column(JSON, comment="text[]: MySQL has no arrays")');
    expect(out).not.toContain('postgresql');

    const sqlite = parse({ database: { dialect: 'sqlite' }, nodes: [{ ...tables[0], data: { columns: [col('t', 'tags', 'text[]')] } }] });
    expect(toSqlAlchemy(sqlite)).toContain('    # text[]: SQLite has no arrays, stored as JSON\n    tags: Mapped[list[str] | None] = mapped_column(JSON)');
  });

  it('marks each table with its role in a feature', () => {
    const d = parse({
      nodes: tables,
      edges,
      features: [{ id: 'f', name: 'Billing', status: 'draft', items: [{ ref: { kind: 'node', id: 'addresses' }, role: 'added' }] }],
    });
    const scoped = scopeToFeature(d, 'f')!;
    const out = toSqlAlchemy(scoped.doc, scoped);
    expect(out).toContain('PostgreSQL, feature Billing.');
    expect(out).toContain('# new in Billing\nclass Address(Base):');
  });
});

describe('SQLModel', () => {
  const py = () => toSqlModel(doc());
  const classBody = (out: string, name: string) => out.slice(out.indexOf(`class ${name}(SQLModel, table=True):`)).split('\n\n\nclass')[0]!;

  it('imports SQLModel and declares a table class per table', () => {
    const out = py();
    expect(out).toContain('SQLModel models for PostgreSQL');
    expect(out).toContain('from sqlmodel import Field, Relationship, SQLModel');
    expect(out).not.toContain('from __future__');
    expect(classBody(out, 'User')).toContain('    __tablename__ = "users"\n    __table_args__ = (\n        Index("users_status", "status", "balance"),');
  });

  it('maps columns to fields with SQL types, names and server defaults', () => {
    const users = classBody(py(), 'User');
    // Filled in by the database: may be left out when creating an object
    expect(users).toContain(
      '    id: UUID | None = Field(default=None, primary_key=True, sa_type=Uuid, sa_column_kwargs={"server_default": text("gen_random_uuid()")})',
    );
    expect(users).toContain('    email: str = Field(sa_type=Text, unique=True, sa_column_kwargs={"comment": "User\'s login"})');
    expect(users).toContain('    status: str | None = Field(default=None, sa_type=String(20), sa_column_kwargs={"server_default": "active"})');
    expect(users).toContain(
      '    created_at: datetime | None = Field(default=None, sa_type=DateTime(timezone=True), sa_column_kwargs={"name": "created at", "server_default": text("now()")})',
    );
    expect(users).toContain('    date_: date | None = Field(default=None, sa_type=Date, sa_column_kwargs={"name": "date"})');
    expect(users).toContain('    tags: list[str] | None = Field(default=None, sa_type=ARRAY(Text))');
  });

  it('keeps NOT NULL on columns that are optional only because the database fills them', () => {
    const d = parse({ nodes: [{ ...tables[0], data: { columns: [col('u1', 'id', 'uuid', { primaryKey: true }), col('u2', 'at', 'timestamptz', { nullable: false, default: 'now()' })] } }] });
    expect(toSqlModel(d)).toContain(
      '    at: datetime | None = Field(default=None, sa_type=DateTime(timezone=True), nullable=False, sa_column_kwargs={"server_default": text("now()")})',
    );
  });

  it('keys auto-increment off the column type', () => {
    expect(classBody(py(), 'Order')).toContain('    id: int | None = Field(default=None, primary_key=True, sa_type=BigInteger)\n');
    expect(classBody(py(), 'Address')).toContain('    id: int = Field(primary_key=True, sa_type=BigInteger, sa_column_kwargs={"autoincrement": False})\n');
  });

  it('puts foreign keys on fields and a relationship on both sides', () => {
    const out = py();
    const orders = classBody(out, 'Order');
    expect(orders).toContain('    __table_args__ = {"schema": "shop"}');
    expect(orders).toContain('    user_id: UUID = Field(sa_type=Uuid, foreign_key="users.id", ondelete="CASCADE")');
    expect(orders).toContain('    user: Optional["User"] = Relationship(back_populates="orders")');
    expect(orders).toContain(
      '    billing_address: Optional["Address"] = Relationship(back_populates="billing_address_orders", sa_relationship_kwargs={"foreign_keys": "Order.billing_address_id"})',
    );
    expect(classBody(out, 'User')).toContain('    orders: list["Order"] = Relationship(back_populates="user", passive_deletes=True)');
    expect(classBody(out, 'User')).toContain('    profile: Optional["Profile"] = Relationship(back_populates="user")');
    expect(classBody(out, 'Category')).toContain(
      '    parent: Optional["Category"] = Relationship(back_populates="categories", sa_relationship_kwargs={"remote_side": "Category.id"})',
    );
  });

  it('follows the project dialect and marks feature roles', () => {
    const mysql = toSqlModel(convertDocDialect(doc(), 'mysql'));
    expect(classBody(mysql, 'Order')).toContain('    __tablename__ = "shop_orders"');
    expect(classBody(mysql, 'Order')).toContain('    id: int | None = Field(default=None, primary_key=True, sa_type=BigInteger)\n');
    const d = parse({
      nodes: tables,
      edges,
      features: [{ id: 'f', name: 'Billing', status: 'draft', items: [{ ref: { kind: 'node', id: 'addresses' }, role: 'added' }] }],
    });
    const scoped = scopeToFeature(d, 'f')!;
    expect(toSqlModel(scoped.doc, scoped)).toContain('# new in Billing\nclass Address(SQLModel, table=True):');
  });
});

describe('FastAPI', () => {
  const ep = (id: string, method: string, path: string, spec: object, extra: object = {}) => ({
    id,
    type: 'endpoint',
    label: '',
    position: at,
    data: { method, path, spec, ...extra },
  });
  const ref = (modelId: string) => ({ kind: 'ref', modelId });
  const apiDoc = (api: object = { auth: 'bearer' }, extra: object = {}) =>
    parse({
      api: { title: 'Shop API', version: '1.2.0', servers: [{ url: 'https://api.shop.test', description: 'prod' }], ...api },
      nodes: [
        ep('get', 'GET', '/orders/{orderId}', {
          operationId: 'getOrder',
          summary: 'Get an order',
          tags: ['orders'],
          params: [
            { id: 'p1', name: 'orderId', in: 'path', type: { ...str, format: 'uuid' }, description: 'The order' },
            { id: 'p2', name: 'X-Trace-Id', in: 'header', type: str },
            { id: 'p3', name: 'expand', in: 'query', type: { ...str, enum: ['items', 'customer'] } },
            { id: 'p4', name: 'from', in: 'query', type: { kind: 'primitive', type: 'integer' }, required: true },
          ],
          responses: [
            { status: '200', description: 'The order', body: ref('order') },
            { status: '404', description: '', body: ref('error') },
            { status: '4XX', description: 'Client error' },
          ],
        }),
        ep('latest', 'GET', '/orders/latest', { responses: [{ status: '200', body: { kind: 'array', items: ref('order') } }] }, { auth: 'public' }),
        ep(
          'post',
          'POST',
          '/orders',
          {
            requestBody: { type: ref('create') },
            responses: [{ status: '201', description: 'Created', body: ref('order') }, { status: '422', description: 'Invalid' }],
            deprecated: true,
          },
          { auth: 'admin' },
        ),
        ep('del', 'DELETE', '/orders/{orderId}', { params: [{ id: 'd1', name: 'orderId', in: 'path', type: str }], responses: [{ status: '204' }] }),
        ep('tags', 'PUT', '/tags', { requestBody: { type: { kind: 'array', items: str }, required: false }, responses: [{ status: '200' }] }),
        { id: 'svc', type: 'service', label: 'OrderService', position: at, data: {} },
        { id: 'orders', type: 'table', label: 'orders', position: at, data: {} },
      ],
      edges: [
        { id: 'e1', kind: 'calls', source: 'post', target: 'svc' },
        { id: 'e2', kind: 'writes', source: 'post', target: 'orders', crud: ['create'] },
      ],
      models: [
        { id: 'order', name: 'OrderDto', fields: [{ id: 'f1', name: 'id', type: { ...str, format: 'uuid' } }] },
        { id: 'create', name: 'CreateOrderDto', fields: [{ id: 'c1', name: 'customerEmail', type: str }] },
        { id: 'error', name: 'ErrorDto', fields: [{ id: 'x1', name: 'message', type: str }] },
      ],
      ...extra,
    });
  const route = (out: string, decorator: string) => out.slice(out.indexOf(decorator)).split('\n\n\n')[0]!;

  it('creates the app from the API settings, after the models', () => {
    const out = toFastApi(apiDoc());
    expect(out).toContain('from fastapi import Body, Depends, FastAPI, HTTPException, Header, Path, Query');
    expect(out).toContain(
      'app = FastAPI(\n    title="Shop API",\n    version="1.2.0",\n    servers=[{"url": "https://api.shop.test", "description": "prod"}],\n)',
    );
    expect(out.indexOf('class ErrorDto(BaseModel)')).toBeLessThan(out.indexOf('app = FastAPI('));
  });

  it('turns params into typed, aliased arguments, required ones first', () => {
    expect(route(toFastApi(apiDoc()), '@app.get(\n    "/orders/{orderId}"')).toBe(
      [
        '@app.get(',
        '    "/orders/{orderId}",',
        '    operation_id="getOrder",',
        '    summary="Get an order",',
        '    response_description="The order",',
        '    tags=["orders"],',
        '    responses={404: {"description": "Not Found", "model": ErrorDto}, "4XX": {"description": "Client error"}},',
        ')',
        'def get_order(',
        '    order_id: Annotated[UUID, Path(alias="orderId", description="The order")],',
        '    from_: Annotated[int, Query(alias="from")],',
        '    user: Annotated[CurrentUser, Depends(current_user)],',
        '    x_trace_id: Annotated[str | None, Header(alias="X-Trace-Id")] = None,',
        '    expand: Annotated[Literal["items", "customer"] | None, Query()] = None,',
        ') -> OrderDto:',
        '    raise HTTPException(status_code=501, detail="Not implemented")',
      ].join('\n'),
    );
  });

  it('maps bodies, status codes and links, and protects admin routes', () => {
    const out = toFastApi(apiDoc());
    const post = route(out, '@app.post(');
    expect(post).toContain('    status_code=201,\n    operation_id="postOrders",');
    expect(post).toContain('    deprecated=True,');
    expect(post).toContain('    body: CreateOrderDto,\n    user: Annotated[CurrentUser, Depends(admin_user)],\n) -> OrderDto:');
    expect(post).toContain('    # Calls OrderService\n    # Writes orders: create\n');
    expect(route(out, '@app.delete(')).toContain('    status_code=204,');
    expect(route(out, '@app.delete(')).toContain(') -> None:');
    expect(route(out, '@app.put(')).toContain('    body: Annotated[list[str] | None, Body()] = None,');
    expect(out).toContain('def admin_user(user: Annotated[CurrentUser, Depends(current_user)]) -> CurrentUser:');
  });

  it('declares literal paths before parameterized ones', () => {
    const out = toFastApi(apiDoc());
    expect(out.indexOf('"/orders/latest"')).toBeLessThan(out.indexOf('"/orders/{orderId}"'));
    expect(route(out, '@app.get(\n    "/orders/latest"')).toContain('def get_orders_latest() -> list[OrderDto]:');
  });

  it('follows the API auth setting', () => {
    expect(toFastApi(apiDoc())).toContain('bearer_scheme = HTTPBearer(scheme_name="bearerAuth", bearerFormat="JWT")');
    const apiKey = toFastApi(apiDoc({ auth: 'apiKey', apiKeyHeader: 'X-Key' }));
    expect(apiKey).toContain('api_key_header = APIKeyHeader(name="X-Key", scheme_name="apiKeyAuth")');
    expect(apiKey).toContain('def current_user(api_key: Annotated[str, Depends(api_key_header)]) -> CurrentUser:');
    const none = toFastApi(apiDoc({ auth: 'none' }));
    expect(none).not.toContain('CurrentUser');
    expect(none).not.toContain('Depends');
  });

  it('keeps helper names free and marks feature roles', () => {
    const base = apiDoc();
    const d = parse({
      ...base,
      models: [...base.models, { id: 'cu', name: 'CurrentUser', fields: [] }],
      features: [{ id: 'f', name: 'Checkout', status: 'draft', items: [{ ref: { kind: 'node', id: 'latest' }, role: 'added' }] }],
    });
    expect(toFastApi(d)).toContain('class CurrentUser_(BaseModel):');
    const scoped = scopeToFeature(d, 'f')!;
    expect(toFastApi(scoped.doc, scoped)).toContain('# new in Checkout\n@app.get(\n    "/orders/latest"');
  });
});

describe('Zod', () => {
  const ts = () => toZod(doc());

  it('exports a schema and its inferred type per model', () => {
    const out = ts();
    expect(out).toContain("\n\nimport { z } from 'zod';\n\n");
    expect(out).toContain('export const Empty = z.object({});\nexport type Empty = z.infer<typeof Empty>;');
    expect(out).toContain('/** An order */\nexport const OrderDto = z.object({\n');
  });

  it('maps field types, keeping API names as keys', () => {
    const out = ts();
    expect(out).toContain('  id: z.uuid(),\n');
    expect(out).toContain("  /** @example a@b.co */\n  customerEmail: z.email(),\n");
    expect(out).toContain("  status: z.enum(['draft', 'paid']),\n");
    expect(out).toContain('  items: z.array(OrderItemDto),\n');
    expect(out).toContain('  /**\n   * Gross "total"\n   * @example 12.5\n   */\n  total: z.number(),\n');
    expect(out).toContain('  note: z.string().optional(),\n');
    expect(out).toContain('  paidAt: z.iso.datetime({ offset: true }).nullable(),\n');
    expect(out).toContain('  class: z.int(),\n');
    expect(out).toContain('  date: z.iso.date(),\n');
  });

  it('defines used models first and reads later ones through getters', () => {
    const out = ts();
    expect(out.indexOf('export const OrderItemDto')).toBeLessThan(out.indexOf('export const OrderDto'));
    expect(out).toContain('  get order() {\n    return OrderDto.optional();\n  },\n');
  });

  it('quotes keys, renames reserved names and maps numeric enums', () => {
    const out = toZod(
      parse({
        models: [
          {
            id: 'm',
            name: 'default',
            description: 'Ends */ early?',
            fields: [
              { id: 'a', name: 'x-trace', type: { kind: 'primitive', type: 'integer', enum: ['1', '2'] } },
              { id: 'b', name: 'it', type: { ...str, enum: ["it's"] } },
              { id: 'c', name: 'n', type: { kind: 'primitive', type: 'integer', format: 'int32' }, nullable: true, required: false },
            ],
          },
        ],
      }),
    );
    expect(out).toContain('/** Ends *\\/ early? */\nexport const default_ = z.object({\n');
    expect(out).toContain("  'x-trace': z.literal([1, 2]),\n");
    expect(out).toContain("  it: z.enum(['it\\'s']),\n");
    expect(out).toContain('  n: z.int32().nullable().optional(),\n');
  });

  it('marks each model with its role in a feature', () => {
    const d = parse({
      models,
      features: [{ id: 'f', name: 'Checkout', status: 'draft', items: [{ ref: { kind: 'model', id: 'item' }, role: 'added' }] }],
    });
    const scoped = scopeToFeature(d, 'f')!;
    expect(toZod(scoped.doc, scoped)).toContain('// new in Checkout\nexport const OrderItemDto');
  });
});

describe('Drizzle', () => {
  const ts = () => toDrizzle(doc());
  const decl = (out: string, name: string) => out.slice(out.indexOf(`export const ${name} =`)).split('\n\n')[0]!;

  it('imports the dialect core and declares schemas', () => {
    const out = ts();
    expect(out).toContain('Drizzle ORM schema for PostgreSQL');
    expect(out).toContain("import { relations, sql } from 'drizzle-orm';");
    expect(out).toContain("import { type AnyPgColumn, bigint, bigserial,");
    expect(out).toContain("export const shopSchema = pgSchema('shop');");
  });

  it('maps columns to builders with keys, defaults and names', () => {
    const users = decl(ts(), 'users');
    expect(users).toContain("    id: uuid().primaryKey().default(sql`gen_random_uuid()`),");
    expect(users).toContain("    /** User's login */\n    email: text().notNull().unique(),");
    expect(users).toContain("    status: varchar({ length: 20 }).default('active'),");
    expect(users).toContain("    createdAt: timestamp('created at', { withTimezone: true }).default(sql`now()`),");
    expect(users).toContain('    balance: numeric({ precision: 10, scale: 2 }).default(sql`0`),');
    expect(users).toContain('    tags: text().array(),');
    expect(users).toContain('    ip: inet(),');
    expect(users).toContain("    index('users_status').on(t.status, t.balance),\n    uniqueIndex('users_date_idx').on(t.date),");
  });

  it('puts schema tables, serials and foreign keys in place', () => {
    const orders = decl(ts(), 'orders');
    expect(orders).toContain("export const orders = shopSchema.table('orders', {");
    expect(orders).toContain("  id: bigserial({ mode: 'number' }).primaryKey(),");
    expect(orders).toContain("  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),");
    // Defined further down: the column type is spelled out
    expect(orders).toContain("  billingAddressId: bigint('billing_address_id', { mode: 'number' }).references((): AnyPgColumn => addresses.id),");
    expect(decl(ts(), 'categories')).toContain("  parentId: integer('parent_id').references((): AnyPgColumn => categories.id),");
    expect(decl(ts(), 'profiles')).toContain('    primaryKey({ columns: [t.userId, t.locale] }),');
  });

  it('adds relations on both sides, named when ambiguous', () => {
    const out = ts();
    expect(decl(out, 'usersRelations')).toBe(
      'export const usersRelations = relations(users, ({ many, one }) => ({\n  orders: many(orders),\n  profile: one(profiles),\n}));',
    );
    expect(decl(out, 'ordersRelations')).toContain(
      "  billingAddress: one(addresses, { fields: [orders.billingAddressId], references: [addresses.id], relationName: 'orders_billingAddress' }),",
    );
    expect(decl(out, 'addressesRelations')).toContain("  billingAddressOrders: many(orders, { relationName: 'orders_billingAddress' }),");
    expect(decl(out, 'categoriesRelations')).toContain("  categories: many(categories, { relationName: 'categories_parent' }),");
  });

  it('follows the project dialect', () => {
    const mysql = toDrizzle(convertDocDialect(doc(), 'mysql'));
    expect(mysql).toContain("from 'drizzle-orm/mysql-core';");
    expect(mysql).toContain("export const orders = mysqlTable('shop_orders', {");
    expect(mysql).toContain("  id: bigint({ mode: 'number' }).primaryKey().autoincrement(),");
    const mariadb = toDrizzle(convertDocDialect(doc(), 'mariadb'));
    expect(mariadb).toContain('const sqlType = (type: string) => customType<{ data: string }>({ dataType: () => type });');
    expect(mariadb).toContain("    id: sqlType('uuid')().primaryKey().default(sql`uuid()`),");
    const sqlite = toDrizzle(convertDocDialect(doc(), 'sqlite'));
    expect(sqlite).toContain("export const users = sqliteTable(");
    expect(sqlite).toContain('  id: integer().primaryKey(),');
  });

  it('marks each table with its role in a feature', () => {
    const d = parse({
      nodes: tables,
      edges,
      features: [{ id: 'f', name: 'Billing', status: 'draft', items: [{ ref: { kind: 'node', id: 'addresses' }, role: 'added' }] }],
    });
    const scoped = scopeToFeature(d, 'f')!;
    expect(toDrizzle(scoped.doc, scoped)).toContain("// new in Billing\nexport const addresses = pgTable('addresses', {");
  });
});

describe('Prisma', () => {
  const schema = () => toPrisma(doc());
  const model = (out: string, name: string) => out.slice(out.indexOf(`model ${name} {`)).split('\n}')[0]!;

  it('declares the generator and datasource for the dialect', () => {
    const out = schema();
    expect(out).toContain('generator client {\n  provider = "prisma-client"\n  output   = "../generated/prisma"\n}');
    expect(out).toContain('datasource db {\n  provider = "postgresql"\n  schemas  = ["public", "shop"]\n}');
    expect(toPrisma(convertDocDialect(doc(), 'mariadb'))).toContain('datasource db {\n  provider = "mysql"\n}');
  });

  it('maps columns to aligned fields with native types and SQL names', () => {
    const user = model(schema(), 'User');
    expect(user.split('\n').slice(0, 13).join('\n')).toBe(
      [
        'model User {',
        '  id        String               @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid',
        "  /// User's login",
        '  email     String               @unique',
        '  status    String?              @default("active") @db.VarChar(20)',
        '  createdAt DateTime?            @default(now()) @map("created at") @db.Timestamptz(6)',
        '  balance   Decimal?             @default(0) @db.Decimal(10, 2)',
        '  date      DateTime?            @db.Date',
        '  tags      String[]',
        '  ip        Unsupported("inet")?',
        '  metadata  Json?',
        '',
        '  orders   Order[]',
      ].join('\n'),
    );
    expect(user).toContain('  @@unique([date], map: "users_date_idx")\n  @@index([status, balance], map: "users_status")\n  @@map("users")\n  @@schema("public")');
  });

  it('adds relations on both sides with referential actions', () => {
    const out = schema();
    expect(model(out, 'Order')).toContain('  id                BigInt  @id @default(autoincrement())');
    expect(model(out, 'Order')).toContain('  user            User     @relation(fields: [userId], references: [id], onDelete: Cascade)');
    expect(model(out, 'Order')).toContain(
      '  billingAddress  Address? @relation("OrderBillingAddress", fields: [billingAddressId], references: [id], onDelete: NoAction)',
    );
    expect(model(out, 'Address')).toContain('  billingAddressOrders  Order[] @relation("OrderBillingAddress")');
    expect(model(out, 'Category')).toContain('  categories Category[] @relation("CategoryParent")');
    expect(model(out, 'Profile')).toContain('  @@id([userId, locale])');
  });

  it('reads a one-to-one as one-to-many unless the FK column is unique', () => {
    expect(model(schema(), 'User')).toContain('  profiles Profile[]');
    const unique = parse({ nodes: tables.map((t) => (t.id === 'profiles' ? { ...t, data: { columns: [col('p1', 'user_id', 'uuid', { primaryKey: true })] } } : t)), edges });
    expect(model(toPrisma(unique), 'User')).toContain('  profile Profile?');
  });

  it('follows the project dialect', () => {
    const sqlite = toPrisma(convertDocDialect(doc(), 'sqlite'));
    expect(sqlite).not.toContain('@db.');
    expect(sqlite).not.toContain('@@schema');
    expect(model(sqlite, 'Order')).toContain('  @@map("shop_orders")');
    expect(model(toPrisma(convertDocDialect(doc(), 'mariadb')), 'User')).toContain('  // uuid: Prisma maps it as char(36)');
  });
});

describe('registry', () => {
  it('finds generators by target', () => {
    expect(codeExportByTarget('pydantic')).toBe(CODE_EXPORTS.pydantic);
    expect(codeExportByTarget('sqlalchemy')?.source).toBe('tables');
    expect(codeExportByTarget('fastapi')?.fileName).toBe('main.py');
    expect(codeExportByTarget('zod')?.language).toBe('typescript');
    expect(codeExportByTarget('prisma')?.fileName).toBe('schema.prisma');
    expect(codeExportByTarget('sqlmodel')?.source).toBe('tables');
    expect(codeExportByTarget('toString')).toBeUndefined();
  });
});
