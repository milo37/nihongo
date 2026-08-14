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

interface DatabaseIdentity {
  hostname: string
  port: string
  databaseName: string
}

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

const getIdentity = (url: URL): DatabaseIdentity => ({
  hostname: url.hostname.toLowerCase(),
  port: url.port || '5432',
  databaseName: url.pathname.replace(/^\//, '')
})

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
  if (
    productionDatabaseUrl &&
    isSameDatabase(target, getIdentity(parseDatabaseUrl(productionDatabaseUrl)))
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
