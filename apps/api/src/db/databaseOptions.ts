const POSTGRES_SCHEMA_PATTERN = /^[a-z_][a-z0-9_]*$/
const PHASE7_STARTUP_ROLES = new Set([
  'nihongo_app',
  'nihongo_auth_gateway',
  'nihongo_phase7_migration'
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
  if (startupRole && !PHASE7_STARTUP_ROLES.has(startupRole)) {
    throw new Error('PostgreSQL startup role is not an approved Phase 7 role.')
  }

  return [
    schema ? `-c search_path=${schema}` : undefined,
    '-c TimeZone=UTC',
    startupRole ? `-c role=${startupRole}` : undefined
  ]
    .filter((option): option is string => option !== undefined)
    .join(' ')
}
