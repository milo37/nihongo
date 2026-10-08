const ALLOWED_DEVELOPMENT_HOSTS = new Set([
  '127.0.0.1',
  '[::1]',
  'localhost',
  'postgres'
])

interface DatabaseGuardInput {
  nodeEnvironment: string | undefined
  databaseUrl: string | undefined
  productionDatabaseUrl?: string | undefined
}

interface AdminCmsDatabaseGuardInput extends DatabaseGuardInput {
  adminCmsMode?: 'disabled' | 'technical' | undefined
}

interface Phase7MigrationDatabaseGuardInput {
  nodeEnvironment: string | undefined
  migrationDatabaseUrl: string | undefined
  runtimeDatabaseUrl: string | undefined
  productionDatabaseUrl: string | undefined
}

interface DatabaseIdentity {
  hostname: string
  port: string
  databaseName: string
  loginName: string
}

const POSTGRES_SCHEMA_PATTERN = /^[a-z_][a-z0-9_]*$/
const PHASE7_MIGRATION_STARTUP_OPTIONS = '-c role=nihongo_phase7_migration'

const parseDatabaseUrl = (value: string): URL => {
  try {
    const parsed = new URL(value)

    if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
      throw new Error('Invalid protocol.')
    }

    return parsed
  } catch {
    throw new Error('Refusing to use an invalid DATABASE_URL.')
  }
}

const decodeUrlIdentity = (value: string): string => {
  try {
    return decodeURIComponent(value)
  } catch {
    throw new Error('Refusing to use a malformed DATABASE_URL identity.')
  }
}

const getIdentity = (url: URL): DatabaseIdentity => ({
  hostname: url.hostname.toLowerCase(),
  port: url.port || '5432',
  databaseName: decodeUrlIdentity(url.pathname.replace(/^\//, '')),
  loginName: decodeUrlIdentity(url.username)
})

const getExactSchema = (url: URL): string => {
  const schemas = url.searchParams.getAll('schema')
  const schema = schemas[0]

  if (
    schemas.length !== 1 ||
    schema === undefined ||
    !POSTGRES_SCHEMA_PATTERN.test(schema)
  ) {
    throw new Error('Phase 7 migration requires one safe schema target.')
  }

  return schema
}

const assertDisabledRuntimeLogin = (
  target: DatabaseIdentity,
  nodeEnvironment: string | undefined
): void => {
  if (nodeEnvironment === 'production') {
    return
  }
  if (nodeEnvironment !== 'test' && nodeEnvironment !== 'development') {
    throw new Error('Disabled admin CMS runtime requires a known NODE_ENV.')
  }
  const expectedEnvironment = target.databaseName.endsWith('_test')
    ? 'test'
    : target.databaseName.endsWith('_dev')
      ? 'development'
      : null
  if (expectedEnvironment === null) {
    throw new Error(
      'Disabled admin CMS runtime requires an environment-suffixed DB.'
    )
  }
  if (nodeEnvironment !== expectedEnvironment) {
    throw new Error('Disabled admin CMS DB does not match NODE_ENV.')
  }
  const expectedLogin =
    expectedEnvironment === 'test'
      ? 'nihongo_test_legacy_app_login'
      : 'nihongo_development_legacy_app_login'
  if (target.loginName !== expectedLogin) {
    throw new Error(
      'Disabled admin CMS runtime requires its exact legacy app login.'
    )
  }
}

const isSameDatabase = (
  left: DatabaseIdentity,
  right: DatabaseIdentity
): boolean =>
  left.hostname === right.hostname &&
  left.port === right.port &&
  left.databaseName === right.databaseName

const assertNotProductionTarget = (
  target: DatabaseIdentity,
  productionDatabaseUrl: string | undefined
): void => {
  if (!productionDatabaseUrl) {
    return
  }

  const production = getIdentity(parseDatabaseUrl(productionDatabaseUrl))

  // A hostname/port literal is not a database identity: localhost, an IP
  // address, a container service name, and a forwarded host port can all reach
  // the same PostgreSQL database. The technical CMS already requires a
  // dedicated _test/_dev database, so a matching database name is sufficient
  // reason to fail closed even when those endpoint literals differ.
  if (
    target.databaseName === production.databaseName ||
    isSameDatabase(target, production)
  ) {
    throw new Error(
      'Development and production DATABASE_URL must not target one DB.'
    )
  }
}

const assertDevelopmentHost = (identity: DatabaseIdentity): void => {
  if (!ALLOWED_DEVELOPMENT_HOSTS.has(identity.hostname)) {
    throw new Error('Database operation requires a loopback or dev host.')
  }
}

export const assertSafeTestDatabase = ({
  nodeEnvironment,
  databaseUrl,
  productionDatabaseUrl
}: DatabaseGuardInput): void => {
  if (nodeEnvironment !== 'test') {
    throw new Error('Test database operations require NODE_ENV=test.')
  }
  if (!databaseUrl) {
    throw new Error('Test DATABASE_URL is required.')
  }

  const testDatabase = getIdentity(parseDatabaseUrl(databaseUrl))
  assertDevelopmentHost(testDatabase)

  if (!testDatabase.databaseName.endsWith('_test')) {
    throw new Error('Test database name must end with _test.')
  }

  assertNotProductionTarget(testDatabase, productionDatabaseUrl)
}

export const assertSafeDevelopmentDatabase = ({
  nodeEnvironment,
  databaseUrl,
  productionDatabaseUrl
}: DatabaseGuardInput): void => {
  if (nodeEnvironment !== 'development') {
    throw new Error('Development migrations require NODE_ENV=development.')
  }
  if (!databaseUrl) {
    throw new Error('Development DATABASE_URL is required.')
  }

  const developmentDatabase = getIdentity(parseDatabaseUrl(databaseUrl))
  assertDevelopmentHost(developmentDatabase)

  if (!developmentDatabase.databaseName.endsWith('_dev')) {
    throw new Error('Development database name must end with _dev.')
  }

  assertNotProductionTarget(developmentDatabase, productionDatabaseUrl)
}

export const assertSafeAdminCmsDatabase = ({
  adminCmsMode,
  nodeEnvironment,
  databaseUrl,
  productionDatabaseUrl
}: AdminCmsDatabaseGuardInput): void => {
  if (adminCmsMode === 'disabled' && databaseUrl) {
    if (nodeEnvironment === 'test') {
      assertSafeTestDatabase({
        nodeEnvironment,
        databaseUrl,
        productionDatabaseUrl
      })
    } else if (nodeEnvironment === 'development') {
      assertSafeDevelopmentDatabase({
        nodeEnvironment,
        databaseUrl,
        productionDatabaseUrl
      })
    }
    assertDisabledRuntimeLogin(
      getIdentity(parseDatabaseUrl(databaseUrl)),
      nodeEnvironment
    )
  }

  if (adminCmsMode !== 'technical') {
    return
  }

  if (!productionDatabaseUrl) {
    throw new Error(
      'Technical admin CMS mode requires PRODUCTION_DATABASE_URL mismatch proof.'
    )
  }

  if (nodeEnvironment === 'test') {
    assertSafeTestDatabase({
      nodeEnvironment,
      databaseUrl,
      productionDatabaseUrl
    })
    return
  }

  if (nodeEnvironment === 'development') {
    assertSafeDevelopmentDatabase({
      nodeEnvironment,
      databaseUrl,
      productionDatabaseUrl
    })
    return
  }

  throw new Error(
    'Technical admin CMS mode requires NODE_ENV=test or development.'
  )
}

export const assertSafePhase7MigrationDatabase = ({
  nodeEnvironment,
  migrationDatabaseUrl,
  runtimeDatabaseUrl,
  productionDatabaseUrl
}: Phase7MigrationDatabaseGuardInput): void => {
  if (!migrationDatabaseUrl) {
    throw new Error('PHASE7_MIGRATION_DATABASE_URL is required.')
  }
  if (!runtimeDatabaseUrl) {
    throw new Error('Phase 7 migration requires the runtime DATABASE_URL.')
  }
  if (!productionDatabaseUrl) {
    throw new Error(
      'Phase 7 migration requires PRODUCTION_DATABASE_URL mismatch proof.'
    )
  }

  if (nodeEnvironment === 'test') {
    assertSafeTestDatabase({
      nodeEnvironment,
      databaseUrl: migrationDatabaseUrl,
      productionDatabaseUrl
    })
  } else if (nodeEnvironment === 'development') {
    assertSafeDevelopmentDatabase({
      nodeEnvironment,
      databaseUrl: migrationDatabaseUrl,
      productionDatabaseUrl
    })
  } else {
    throw new Error('Phase 7 migration requires NODE_ENV=test or development.')
  }

  const migration = parseDatabaseUrl(migrationDatabaseUrl)
  const runtime = parseDatabaseUrl(runtimeDatabaseUrl)
  const migrationIdentity = getIdentity(migration)
  const runtimeIdentity = getIdentity(runtime)
  const expectedLogin =
    nodeEnvironment === 'test'
      ? 'nihongo_test_phase7_migration_login'
      : 'nihongo_development_phase7_migration_login'

  if (migrationIdentity.loginName !== expectedLogin) {
    throw new Error(
      'Phase 7 migration requires its exact canonical migration login.'
    )
  }

  const startupOptions = migration.searchParams.getAll('options')
  if (
    startupOptions.length !== 1 ||
    startupOptions[0] !== PHASE7_MIGRATION_STARTUP_OPTIONS
  ) {
    throw new Error(
      'Phase 7 migration requires one exact migration startup role option.'
    )
  }

  if (
    !isSameDatabase(migrationIdentity, runtimeIdentity) ||
    getExactSchema(migration) !== getExactSchema(runtime)
  ) {
    throw new Error(
      'Phase 7 migration and runtime URLs must target one exact database schema.'
    )
  }
}
