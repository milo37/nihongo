export type ApiIntegrationOwner = 'phase7-api' | 'phase7-db' | 'phase10'

export interface ApiIntegrationManifestEntry {
  readonly path: `src/${string}.integration.test.ts`
  readonly executionOwner: ApiIntegrationOwner
  readonly shard: string
  readonly order: number
  readonly databaseState: string
  readonly connectionRole: 'none' | 'application' | 'owner' | 'migration'
  readonly requiredEnvironment: readonly string[]
  readonly seedPolicy: 'none' | 'canonical-once' | 'canonical-twice'
  readonly isolation: string
}

export const apiIntegrationManifest = [
  {
    path: 'src/study/studyGuestCleanupWorker.integration.test.ts',
    executionOwner: 'phase10',
    shard: 'current-guest-cleanup',
    order: 24,
    databaseState: 'phase7-current-canonical-65',
    connectionRole: 'application',
    requiredEnvironment: [
      'GUEST_CLEANUP_DATABASE_URL',
      'GUEST_CLEANUP_FIXTURE_DATABASE_URL',
      'PHASE7_RUNTIME_DATABASE_URL',
      'PHASE7_API_ERASURE_DATABASE_URL',
      'GUEST_CLEANUP_TEST_ISOLATED'
    ],
    seedPolicy: 'canonical-once',
    isolation:
      'dedicated nihongo_jlp534_test database and jlp534 schema; guest worker has function EXECUTE only'
  },
  {
    path: 'src/app/apiGate.integration.test.ts',
    executionOwner: 'phase7-api',
    shard: 'phase7-api-post-seed',
    order: 2,
    databaseState: 'phase7-current-capability-active-canonical-65',
    connectionRole: 'application',
    requiredEnvironment: ['AUTH_GATEWAY_DATABASE_URL'],
    seedPolicy: 'canonical-once',
    isolation: 'dedicated Phase 7 API schema'
  },
  {
    path: 'src/admin/adminQuestionRepository.integration.test.ts',
    executionOwner: 'phase7-api',
    shard: 'phase7-api-pre-seed',
    order: 1,
    databaseState: 'phase7-prefix37-capability-active-empty',
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
    path: 'src/db/phase7Sso.integration.test.ts',
    executionOwner: 'phase7-db',
    shard: 'phase7-db-sso',
    order: 12,
    databaseState: 'canonical43-sso-current-capability-active-canonical-65',
    connectionRole: 'owner',
    requiredEnvironment: [
      'AUTH_GATEWAY_DATABASE_URL',
      'PHASE7_ADMIN_DATABASE_URL'
    ],
    seedPolicy: 'canonical-once',
    isolation:
      'existing runner-owned disposable Phase 7 schema; SQL-only provider proofs; no external OAuth'
  },
  {
    path: 'src/db/phase7SsoAccountLifecycle.integration.test.ts',
    executionOwner: 'phase7-db',
    shard: 'phase7-db-sso-account-lifecycle',
    order: 13,
    databaseState:
      'canonical46-account-lifecycle-current-capability-active-canonical-65',
    connectionRole: 'owner',
    requiredEnvironment: [
      'DATABASE_URL',
      'AUTH_GATEWAY_DATABASE_URL',
      'PHASE7_ADMIN_DATABASE_URL'
    ],
    seedPolicy: 'canonical-once',
    isolation:
      'existing runner-owned disposable TEST schema; exact3; SQL-only proofs; no external OAuth'
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
    path: 'src/content/approvedReadingTags.integration.test.ts',
    executionOwner: 'phase7-db',
    shard: 'phase7-db-approved-reading-tags',
    order: 7,
    databaseState: 'seeded-65-tags108-applicability127-registration-unapplied',
    connectionRole: 'owner',
    requiredEnvironment: ['DATABASE_URL', 'PHASE7_ADMIN_DATABASE_URL'],
    seedPolicy: 'canonical-once',
    isolation:
      'separately prepared disposable fixture; suite mutations roll back'
  },
  {
    path: 'src/content/approvedN3ReadingTags.integration.test.ts',
    executionOwner: 'phase7-db',
    shard: 'phase7-db-approved-n3-reading-tags',
    order: 8,
    databaseState:
      'canonical33-plus-n3-migration-seeded-65-before-n5-application',
    connectionRole: 'owner',
    requiredEnvironment: [
      'DATABASE_URL',
      'PRISMA_TEST_DATABASE_URL',
      'PHASE7_ADMIN_DATABASE_URL'
    ],
    seedPolicy: 'canonical-once',
    isolation:
      'separately prepared disposable fixture; suite mutations roll back'
  },
  {
    path: 'src/content/approvedN4N2ReadingTags.integration.test.ts',
    executionOwner: 'phase7-db',
    shard: 'phase7-db-approved-n4-n2-reading-tags',
    order: 9,
    databaseState: 'canonical36-seeded-65-without-current-catalog107-126',
    connectionRole: 'owner',
    requiredEnvironment: [
      'DATABASE_URL',
      'PRISMA_TEST_DATABASE_URL',
      'PHASE7_ADMIN_DATABASE_URL'
    ],
    seedPolicy: 'canonical-once',
    isolation:
      'separately prepared disposable fixture; suite mutations roll back'
  },
  {
    path: 'src/content/approvedN4ReadingBatch7Tags.integration.test.ts',
    executionOwner: 'phase7-db',
    shard: 'phase7-db-approved-batch7-reading-tags',
    order: 10,
    databaseState: 'explicit-legacy-or-current-batch7-unapplied-predecessor',
    connectionRole: 'owner',
    requiredEnvironment: [
      'DATABASE_URL',
      'PRISMA_TEST_DATABASE_URL',
      'PHASE7_ADMIN_DATABASE_URL'
    ],
    seedPolicy: 'canonical-once',
    isolation:
      'separately prepared disposable fixture; suite mutations roll back'
  },
  {
    path: 'src/content/approved308Tags.integration.test.ts',
    executionOwner: 'phase7-db',
    shard: 'phase7-db-approved308-tags',
    order: 11,
    databaseState: 'current38-seeded-65-tags107-applicability126-no-imports',
    connectionRole: 'owner',
    requiredEnvironment: [
      'DATABASE_URL',
      'PRISMA_TEST_DATABASE_URL',
      'PHASE7_ADMIN_DATABASE_URL',
      'PHASE7_APPROVED308_FIXTURE_PROFILE'
    ],
    seedPolicy: 'canonical-once',
    isolation:
      'separately prepared disposable fixture; suite mutations roll back'
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
] satisfies readonly ApiIntegrationManifestEntry[]

export const getApiIntegrationEntriesByOwner = (
  executionOwner: ApiIntegrationOwner
): readonly ApiIntegrationManifestEntry[] =>
  apiIntegrationManifest
    .filter((entry) => entry.executionOwner === executionOwner)
    .toSorted((left, right) => left.order - right.order)

export const getApiIntegrationPathsByOwner = (
  executionOwner: ApiIntegrationOwner
): readonly `src/${string}.integration.test.ts`[] =>
  getApiIntegrationEntriesByOwner(executionOwner).map(
    ({ path: testPath }) => testPath
  )
