const POSTGRES_SCHEMA_PATTERN = /^[a-z_][a-z0-9_]*$/
const APPROVED_POSTGRES_STARTUP_ROLES = new Set([
  'nihongo_app',
  'nihongo_guest_cleanup_worker',
  'nihongo_migration'
])

export const getPostgresSchema = (
  connectionString: string
): string | undefined => {
  const schemas = new URL(connectionString).searchParams.getAll('schema')

  if (schemas.length === 0) {
    return undefined
  }

  const schema = schemas[0]

  if (
    schemas.length !== 1 ||
    schema === undefined ||
    !POSTGRES_SCHEMA_PATTERN.test(schema)
  ) {
    throw new Error('PostgreSQL schema must be one safe identifier.')
  }

  return schema
}

export const createPostgresStartupOptions = (
  schema: string | undefined,
  startupRole?: string
): string => {
  if (startupRole && !APPROVED_POSTGRES_STARTUP_ROLES.has(startupRole)) {
    throw new Error('PostgreSQL startup role is not an approved role.')
  }

  return [
    schema ? `-c search_path=${schema}` : undefined,
    '-c TimeZone=UTC',
    startupRole ? `-c role=${startupRole}` : undefined
  ]
    .filter((option): option is string => option !== undefined)
    .join(' ')
}

// pg 8 treats these sslmode values as verify-full; its next major gives them
// the libpq meaning (require = encrypt without checking the certificate).
const NODE_POSTGRES_VERIFY_FULL_ALIASES =
  /([?&])sslmode=(prefer|require|verify-ca)(?=&|$)/giu

/**
 * #1355: pins the TLS check node-postgres does today. The stored URLs keep
 * sslmode=require (Prisma migrate reads them too); only what node-postgres
 * receives says verify-full, so a pg upgrade cannot drop the check.
 */
export const toNodePostgresConnectionString = (
  connectionString: string
): string => {
  return connectionString.replace(
    NODE_POSTGRES_VERIFY_FULL_ALIASES,
    '$1sslmode=verify-full'
  )
}
