/**
 * Registers the database capability row as the migration role (#504 P8-1).
 *
 * The baseline has no registration function: this is the statement
 * phase7_register_database_capability ran, with the same target checks. The
 * row is accepted only for the database it runs on, at its own server
 * address and port, with a TEST or DEVELOPMENT environment that matches the
 * database name. The runtime check require_database_capability compares the
 * row with the live endpoint on every guarded call.
 */
interface PgQueryable {
  query: (
    sql: string,
    values?: unknown[]
  ) => Promise<{ rowCount: number | null }>
}

export type CapabilityEnvironment = 'TEST' | 'DEVELOPMENT' | 'PRODUCTION'

export const DATABASE_CAPABILITY_SQL = `INSERT INTO "DatabaseCapability" (
    "id", "databaseName", "serverAddress", "serverPort", "environment",
    "registeredAt"
  )
  SELECT 1, current_database(), inet_server_addr(), inet_server_port(),
    $1::"AdminAuditEnvironment", clock_timestamp()
  WHERE inet_server_addr() IS NOT NULL
    AND (($1 = 'TEST' AND current_database() ~ '_test$')
      OR ($1 = 'DEVELOPMENT' AND current_database() ~ '_dev$')
      OR $1 = 'PRODUCTION')
  ON CONFLICT ("id") DO UPDATE SET
    "databaseName" = EXCLUDED."databaseName",
    "serverAddress" = EXCLUDED."serverAddress",
    "serverPort" = EXCLUDED."serverPort",
    "environment" = EXCLUDED."environment",
    "registeredAt" = EXCLUDED."registeredAt"`

export const registerDatabaseCapability = async (
  client: PgQueryable,
  environment: CapabilityEnvironment
): Promise<void> => {
  const result = await client.query(DATABASE_CAPABILITY_SQL, [environment])
  if (result.rowCount !== 1)
    throw new Error('Database capability does not match the safe target.')
}
