import {
  assertSafeDevelopmentDatabase,
  assertSafeTestDatabase
} from '../db/databaseTargetGuard.js'

interface ReviewReconciliationTargetGuardInput {
  readonly databaseUrl: string
  readonly nodeEnvironment: 'development' | 'production' | 'test'
  readonly productionDatabaseUrl?: string | undefined
}

export const assertSafeReviewReconciliationTarget = ({
  databaseUrl,
  nodeEnvironment,
  productionDatabaseUrl
}: ReviewReconciliationTargetGuardInput): void => {
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
    'Production reconciliation requires a separately approved exact-target runbook.'
  )
}
