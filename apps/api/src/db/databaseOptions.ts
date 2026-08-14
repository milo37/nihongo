const POSTGRES_SCHEMA_PATTERN = /^[a-z_][a-z0-9_]*$/

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
