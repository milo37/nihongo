import type { QueryResultRow } from 'pg'

/**
 * A schema catalog for the baseline equivalence test (#504 P8-1): every
 * object the schema holds, with the schema name replaced by `$SCHEMA` so two
 * schemas compare by content.
 */
interface PgQueryable {
  query: <Row extends QueryResultRow = QueryResultRow>(
    sql: string,
    values?: unknown[]
  ) => Promise<{ rows: Row[] }>
}

export interface SchemaCatalog {
  readonly types: Array<Record<string, unknown>>
  readonly tables: Array<Record<string, unknown>>
  readonly columns: Array<Record<string, unknown>>
  readonly constraints: Array<Record<string, unknown>>
  readonly indexes: Array<Record<string, unknown>>
  readonly functions: Array<Record<string, unknown>>
  readonly triggers: Array<Record<string, unknown>>
  readonly schemaAcl: string | null
}

const CATALOG_QUERIES = {
  types: `SELECT t.typname AS name, t.typtype AS kind, r.rolname AS owner,
      COALESCE(t.typacl, acldefault('T', t.typowner))::text AS acl,
      (SELECT array_agg(e.enumlabel::text ORDER BY e.enumsortorder)
       FROM pg_enum e WHERE e.enumtypid = t.oid) AS labels
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    JOIN pg_roles r ON r.oid = t.typowner
    WHERE n.nspname = $1 AND t.typtype IN ('e', 'd') ORDER BY 1`,
  tables: `SELECT c.relname AS name, r.rolname AS owner,
      COALESCE(c.relacl, acldefault('r', c.relowner))::text AS acl,
      c.relrowsecurity AS "rowSecurity"
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_roles r ON r.oid = c.relowner
    WHERE n.nspname = $1 AND c.relkind IN ('r', 'p', 'v', 'm', 'S')
      AND c.relname <> '_prisma_migrations'
    ORDER BY 1`,
  columns: `SELECT c.relname AS "table", a.attname AS name,
      row_number() OVER (PARTITION BY c.oid ORDER BY a.attnum)::int AS position,
      format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull AS "notNull",
      pg_get_expr(d.adbin, d.adrelid) AS "default", a.attidentity AS identity,
      a.attgenerated AS generated, a.attacl::text AS acl
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE n.nspname = $1 AND c.relkind IN ('r', 'p')
      AND c.relname <> '_prisma_migrations'
      AND a.attnum > 0 AND NOT a.attisdropped
    ORDER BY 1, 3`,
  constraints: `SELECT c.relname AS "table", k.conname AS name, k.contype AS kind,
      pg_get_constraintdef(k.oid) AS definition, k.condeferrable AS deferrable,
      k.condeferred AS deferred
    FROM pg_constraint k
    JOIN pg_class c ON c.oid = k.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = $1 AND c.relname <> '_prisma_migrations'
    ORDER BY 1, 2`,
  indexes: `SELECT t.relname AS "table", i.relname AS name,
      pg_get_indexdef(x.indexrelid) AS definition
    FROM pg_index x
    JOIN pg_class i ON i.oid = x.indexrelid
    JOIN pg_class t ON t.oid = x.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = $1 AND t.relname <> '_prisma_migrations'
    ORDER BY 1, 2`,
  functions: `SELECT p.proname AS name, pg_get_function_identity_arguments(p.oid) AS args,
      pg_get_function_result(p.oid) AS result, p.prosecdef AS definer,
      p.provolatile AS volatility, p.proisstrict AS strict, l.lanname AS language,
      p.proconfig AS config,
      COALESCE(p.proacl, acldefault('f', p.proowner))::text AS acl,
      r.rolname AS owner,
      p.prosrc AS source
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_language l ON l.oid = p.prolang
    JOIN pg_roles r ON r.oid = p.proowner
    WHERE n.nspname = $1 ORDER BY 1, 2`,
  triggers: `SELECT c.relname AS "table", t.tgname AS name,
      pg_get_triggerdef(t.oid) AS definition, t.tgenabled AS enabled
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = $1 AND NOT t.tgisinternal ORDER BY 1, 2`
} as const

const normalize = (value: unknown, schema: string): unknown => {
  if (typeof value === 'string') return value.split(schema).join('$SCHEMA')
  if (Array.isArray(value)) return value.map((item) => normalize(item, schema))
  return value
}

export const readSchemaCatalog = async (
  client: PgQueryable,
  schema: string
): Promise<SchemaCatalog> => {
  const read = async (sql: string) =>
    (await client.query<Record<string, unknown>>(sql, [schema])).rows.map(
      (row) =>
        Object.fromEntries(
          Object.entries(row).map(([key, value]) => [
            key,
            normalize(value, schema)
          ])
        )
    )
  const [types, tables, columns, constraints, indexes, functions, triggers] =
    await Promise.all([
      read(CATALOG_QUERIES.types),
      read(CATALOG_QUERIES.tables),
      read(CATALOG_QUERIES.columns),
      read(CATALOG_QUERIES.constraints),
      read(CATALOG_QUERIES.indexes),
      read(CATALOG_QUERIES.functions),
      read(CATALOG_QUERIES.triggers)
    ])
  const schemaAcl = (
    await client.query<{ acl: string | null }>(
      `SELECT COALESCE(nspacl, acldefault('n', nspowner))::text AS acl
       FROM pg_namespace WHERE nspname = $1`,
      [schema]
    )
  ).rows[0]?.acl
  return {
    types,
    tables,
    columns,
    // A CHECK re-read from its own text loses redundant parentheses.
    constraints: constraints.map((row) => ({
      ...row,
      definition: String(row.definition).replace(/[()\s]/gu, '')
    })),
    indexes,
    functions,
    triggers,
    schemaAcl: schemaAcl ?? null
  }
}
