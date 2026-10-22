import {
  assertSafeDevelopmentDatabase,
  assertSafeTestDatabase
} from '../db/databaseTargetGuard.js'

interface StudySessionCleanupTargetGuardInput {
  databaseUrl: string
  nodeEnvironment: 'development' | 'test' | 'production'
  productionDatabaseUrl?: string | undefined
}

export const assertSafeStudySessionCleanupTarget = ({
  databaseUrl,
  nodeEnvironment,
  productionDatabaseUrl
}: StudySessionCleanupTargetGuardInput): void => {
  const input = { databaseUrl, nodeEnvironment, productionDatabaseUrl }
  if (nodeEnvironment === 'test') {
    assertSafeTestDatabase(input)
    return
  }
  if (nodeEnvironment === 'development') {
    assertSafeDevelopmentDatabase(input)
    return
  }
  throw new Error(
    'Production cleanup requires a separately approved exact-target runbook.'
  )
}
