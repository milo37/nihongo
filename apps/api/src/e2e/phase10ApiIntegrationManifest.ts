export type Phase10IntegrationOwner = 'phase7-api' | 'phase7-db' | 'phase10'

export interface Phase10ApiIntegrationManifestEntry {
  readonly path: `src/${string}.integration.test.ts`
  readonly executionOwner: Phase10IntegrationOwner
  readonly shard: string
  readonly order: number
  readonly databaseState: string
  readonly connectionRole: 'none' | 'application' | 'owner' | 'migration'
  readonly requiredEnvironment: readonly string[]
  readonly seedPolicy: 'none' | 'canonical-once' | 'canonical-twice'
  readonly isolation: string
}

export const phase10ApiIntegrationManifest = [
  {
    path: 'src/app/phase7ApiGate.integration.test.ts',
    executionOwner: 'phase7-api',
    shard: 'phase7-api-pre-seed',
    order: 1,
    databaseState: 'phase7-current-capability-active',
    connectionRole: 'application',
    requiredEnvironment: ['AUTH_GATEWAY_DATABASE_URL'],
    seedPolicy: 'none',
    isolation: 'dedicated Phase 7 API schema'
  },
  {
    path: 'src/admin/adminQuestionRepository.integration.test.ts',
    executionOwner: 'phase7-api',
    shard: 'phase7-api-pre-seed',
    order: 2,
    databaseState: 'phase7-current-capability-active',
    connectionRole: 'application',
    requiredEnvironment: ['PHASE7_API_ADMIN_DATABASE_URL'],
    seedPolicy: 'none',
    isolation: 'dedicated Phase 7 API schema'
  },
  {
    path: 'src/admin/adminQuestionCommandRepository.integration.test.ts',
    executionOwner: 'phase7-api',
    shard: 'phase7-api-post-seed',
    order: 3,
    databaseState: 'phase7-current-capability-active-canonical-65',
    connectionRole: 'application',
    requiredEnvironment: ['PHASE7_API_ADMIN_DATABASE_URL'],
    seedPolicy: 'canonical-once',
    isolation: 'dedicated Phase 7 API schema'
  },
  {
    path: 'src/db/phase7AdminCmsFoundation.integration.test.ts',
    executionOwner: 'phase7-db',
    shard: 'phase7-db-current',
    order: 1,
    databaseState: 'phase7-current-capability-active-canonical-65',
    connectionRole: 'owner',
    requiredEnvironment: ['PHASE7_MIGRATION_DATABASE_URL'],
    seedPolicy: 'canonical-once',
    isolation: 'dedicated Phase 7 DB schema and canonical roles'
  },
  {
    path: 'src/db/phase7ReauthenticationFoundation.integration.test.ts',
    executionOwner: 'phase7-db',
    shard: 'phase7-db-current',
    order: 2,
    databaseState: 'phase7-current-capability-active-canonical-65',
    connectionRole: 'owner',
    requiredEnvironment: ['AUTH_GATEWAY_DATABASE_URL'],
    seedPolicy: 'canonical-once',
    isolation: 'dedicated Phase 7 DB schema and canonical roles'
  },
  {
    path: 'src/db/phase7ReauthenticationService.integration.test.ts',
    executionOwner: 'phase7-db',
    shard: 'phase7-db-current',
    order: 3,
    databaseState: 'phase7-current-capability-active-canonical-65',
    connectionRole: 'owner',
    requiredEnvironment: ['AUTH_GATEWAY_DATABASE_URL'],
    seedPolicy: 'canonical-once',
    isolation: 'dedicated Phase 7 DB schema and canonical roles'
  },
  {
    path: 'src/dashboard/dashboardInsights.integration.test.ts',
    executionOwner: 'phase7-db',
    shard: 'phase7-db-current',
    order: 4,
    databaseState: 'phase7-current-capability-active-canonical-65',
    connectionRole: 'application',
    requiredEnvironment: ['DATABASE_URL'],
    seedPolicy: 'canonical-once',
    isolation: 'dedicated Phase 7 DB schema and canonical roles'
  },
  {
    path: 'src/dashboard/dashboardInsightsPerformance.integration.test.ts',
    executionOwner: 'phase7-db',
    shard: 'phase7-db-current',
    order: 5,
    databaseState: 'phase7-current-capability-active-canonical-65',
    connectionRole: 'application',
    requiredEnvironment: ['DATABASE_URL'],
    seedPolicy: 'canonical-once',
    isolation: 'dedicated Phase 7 DB schema and canonical roles'
  },
  {
    path: 'src/db/phase7AdminCmsUpgrade.integration.test.ts',
    executionOwner: 'phase7-db',
    shard: 'phase7-db-upgrade',
    order: 6,
    databaseState: 'self-managed-phase7-upgrade-history',
    connectionRole: 'owner',
    requiredEnvironment: ['PHASE7_MIGRATION_DATABASE_URL'],
    seedPolicy: 'none',
    isolation: 'suite-owned migration-history schema'
  },
  {
    path: 'src/app/createApp.integration.test.ts',
    executionOwner: 'phase10',
    shard: 'pure',
    order: 1,
    databaseState: 'none',
    connectionRole: 'none',
    requiredEnvironment: [],
    seedPolicy: 'none',
    isolation: 'process-only route composition'
  },
  {
    path: 'src/db/database.integration.test.ts',
    executionOwner: 'phase10',
    shard: 'current-zero-facts',
    order: 2,
    databaseState: 'phase7-current-canonical-65-zero-learner-facts',
    connectionRole: 'application',
    requiredEnvironment: ['DATABASE_URL'],
    seedPolicy: 'canonical-once',
    isolation: 'dedicated Phase 10 schema before learner writes'
  },
  {
    path: 'src/db/practiceCompatibilityFence.integration.test.ts',
    executionOwner: 'phase10',
    shard: 'current-zero-facts',
    order: 3,
    databaseState: 'phase7-current-canonical-65-zero-learner-facts',
    connectionRole: 'application',
    requiredEnvironment: [
      'DATABASE_URL',
      'PHASE10_FIXTURE_DATABASE_URL',
      'PHASE7_API_ERASURE_DATABASE_URL'
    ],
    seedPolicy: 'canonical-once',
    isolation: 'dedicated Phase 10 schema before learner writes'
  },
  {
    path: 'src/question/questionCatalog.integration.test.ts',
    executionOwner: 'phase10',
    shard: 'catalog-baseline',
    order: 4,
    databaseState: 'phase7-current-canonical-65',
    connectionRole: 'application',
    requiredEnvironment: ['DATABASE_URL', 'PHASE10_FIXTURE_DATABASE_URL'],
    seedPolicy: 'canonical-once',
    isolation:
      'runs before any learner writes; owner is limited to rollback-only invariant probes'
  },
  {
    path: 'src/db/studySubmissionIntegrity.integration.test.ts',
    executionOwner: 'phase10',
    shard: 'current-app-role',
    order: 5,
    databaseState: 'phase7-current-canonical-65',
    connectionRole: 'application',
    requiredEnvironment: [
      'DATABASE_URL',
      'PHASE10_FIXTURE_DATABASE_URL',
      'PHASE7_API_ERASURE_DATABASE_URL'
    ],
    seedPolicy: 'canonical-once',
    isolation: 'dedicated Phase 10 schema'
  },
  {
    path: 'src/study/studySessionCleanup.integration.test.ts',
    executionOwner: 'phase10',
    shard: 'current-app-role',
    order: 6,
    databaseState: 'phase7-current-canonical-65',
    connectionRole: 'application',
    requiredEnvironment: [
      'DATABASE_URL',
      'PHASE10_FIXTURE_DATABASE_URL',
      'PHASE7_API_ERASURE_DATABASE_URL'
    ],
    seedPolicy: 'canonical-once',
    isolation: 'dedicated Phase 10 schema'
  },
  ...[
    'study/studyDraft.integration.test.ts',
    'study/studyDraftCleanup.integration.test.ts',
    'study/studyDraftQueryPlan.integration.test.ts',
    'study/studySelectionQueryPlan.integration.test.ts',
    'study/studySessionMigration.integration.test.ts'
  ].map((relativePath, index) => ({
    path: `src/${relativePath}` as `src/${string}.integration.test.ts`,
    executionOwner: 'phase10' as const,
    shard: 'current-app-role-with-owner-fixtures',
    order: 7 + index,
    databaseState: 'phase7-current-canonical-65',
    connectionRole: 'application' as const,
    requiredEnvironment: [
      'DATABASE_URL',
      'PHASE10_FIXTURE_DATABASE_URL',
      'PHASE7_API_ERASURE_DATABASE_URL',
      'AUTH_GATEWAY_DATABASE_URL'
    ],
    seedPolicy: 'canonical-once' as const,
    isolation: 'dedicated Phase 10 schema; owner only for fixture setup'
  })),
  ...[
    'auth/auth.integration.test.ts',
    'bookmark/bookmark.integration.test.ts',
    'review/reviewCenterFoundation.integration.test.ts',
    'review/reviewCenterFoundationQueryPlan.integration.test.ts',
    'study/studyResultRetry.integration.test.ts',
    'study/studySession.integration.test.ts',
    'study/studySubmission.integration.test.ts',
    'wrong-note/wrongNoteDashboard.integration.test.ts',
    'wrong-note/wrongNoteReviewCenter.integration.test.ts'
  ].map((relativePath, index) => ({
    path: `src/${relativePath}` as `src/${string}.integration.test.ts`,
    executionOwner: 'phase10' as const,
    shard: 'current-rebased-service',
    order: 12 + index,
    databaseState: 'phase7-current-canonical-65',
    connectionRole: 'application' as const,
    requiredEnvironment:
      relativePath === 'auth/auth.integration.test.ts' ||
      relativePath === 'study/studySession.integration.test.ts'
        ? [
            'DATABASE_URL',
            'PHASE10_FIXTURE_DATABASE_URL',
            'PHASE7_API_ERASURE_DATABASE_URL',
            'AUTH_GATEWAY_DATABASE_URL'
          ]
        : [
            'DATABASE_URL',
            'PHASE10_FIXTURE_DATABASE_URL',
            'PHASE7_API_ERASURE_DATABASE_URL'
          ],
    seedPolicy: 'canonical-once' as const,
    isolation: 'disposable fixture aggregate in dedicated Phase 10 schema'
  })),
  {
    path: 'src/db/questionCatalogMigration.integration.test.ts',
    executionOwner: 'phase10',
    shard: 'migration-question-catalog',
    order: 21,
    databaseState: 'suite-managed-empty-question-catalog-schema',
    connectionRole: 'owner',
    requiredEnvironment: ['PHASE10_FIXTURE_DATABASE_URL'],
    seedPolicy: 'none',
    isolation: 'suite-owned upgrade schema'
  },
  {
    path: 'src/db/studySubmissionUpgrade.integration.test.ts',
    executionOwner: 'phase10',
    shard: 'migration-submission-history',
    order: 22,
    databaseState: 'suite-managed-empty-submission-history-schema',
    connectionRole: 'application',
    requiredEnvironment: [
      'DATABASE_URL',
      'PHASE10_APPLICATION_DATABASE_URL',
      'PHASE10_FIXTURE_DATABASE_URL',
      'PHASE7_MIGRATION_DATABASE_URL',
      'AUTH_GATEWAY_DATABASE_URL'
    ],
    seedPolicy: 'none',
    isolation: 'suite-owned migration directory and schema'
  },
  {
    path: 'src/db/prismaLedgerUpgrade.integration.test.ts',
    executionOwner: 'phase10',
    shard: 'migration-ledger-last',
    order: 23,
    databaseState: 'suite-managed-prisma-ledger-history',
    connectionRole: 'migration',
    requiredEnvironment: ['PHASE7_MIGRATION_DATABASE_URL'],
    seedPolicy: 'none',
    isolation: 'last; suite-owned ledger replay schema'
  }
] satisfies readonly Phase10ApiIntegrationManifestEntry[]

export const getPhase10ApiIntegrationEntriesByOwner = (
  executionOwner: Phase10IntegrationOwner
): readonly Phase10ApiIntegrationManifestEntry[] =>
  phase10ApiIntegrationManifest
    .filter((entry) => entry.executionOwner === executionOwner)
    .toSorted((left, right) => left.order - right.order)

export const getPhase10ApiIntegrationPathsByOwner = (
  executionOwner: Phase10IntegrationOwner
): readonly `src/${string}.integration.test.ts`[] =>
  getPhase10ApiIntegrationEntriesByOwner(executionOwner).map(
    ({ path: testPath }) => testPath
  )
