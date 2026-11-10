type ApiIntegrationOwner = 'api' | 'db' | 'shard'

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
    executionOwner: 'shard',
    shard: 'current-guest-cleanup',
    order: 24,
    databaseState: 'current-canonical-65',
    connectionRole: 'application',
    requiredEnvironment: [
      'GUEST_CLEANUP_DATABASE_URL',
      'GUEST_CLEANUP_FIXTURE_DATABASE_URL',
      'RUNTIME_DATABASE_URL',
      'TEST_APP_FIXTURE_DATABASE_URL',
      'GUEST_CLEANUP_TEST_ISOLATED'
    ],
    seedPolicy: 'canonical-once',
    isolation:
      'dedicated nihongo_jlp534_test database and jlp534 schema; guest worker has function EXECUTE only'
  },
  {
    path: 'src/app/apiGate.integration.test.ts',
    executionOwner: 'api',
    shard: 'api-post-seed',
    order: 2,
    databaseState: 'current-capability-active-canonical-65',
    connectionRole: 'application',
    requiredEnvironment: ['TEST_APP_FIXTURE_DATABASE_URL'],
    seedPolicy: 'canonical-once',
    isolation: 'dedicated API schema'
  },
  {
    path: 'src/admin/adminQuestionRepository.integration.test.ts',
    executionOwner: 'api',
    shard: 'api-pre-seed',
    order: 1,
    databaseState: 'prefix37-capability-active-empty',
    connectionRole: 'application',
    requiredEnvironment: ['TEST_API_ADMIN_DATABASE_URL'],
    seedPolicy: 'none',
    isolation: 'dedicated API schema'
  },
  {
    path: 'src/admin/adminQuestionCommandRepository.integration.test.ts',
    executionOwner: 'api',
    shard: 'api-post-seed',
    order: 3,
    databaseState: 'current-capability-active-canonical-65',
    connectionRole: 'application',
    requiredEnvironment: ['TEST_API_ADMIN_DATABASE_URL'],
    seedPolicy: 'canonical-once',
    isolation: 'dedicated API schema'
  },
  {
    path: 'src/db/sso.integration.test.ts',
    executionOwner: 'db',
    shard: 'db-sso',
    order: 12,
    databaseState: 'canonical43-sso-current-capability-active-canonical-65',
    connectionRole: 'owner',
    requiredEnvironment: [
      'TEST_APP_FIXTURE_DATABASE_URL',
      'ADMIN_DATABASE_URL'
    ],
    seedPolicy: 'canonical-once',
    isolation:
      'existing runner-owned disposable schema; SQL-only provider proofs; no external OAuth'
  },
  {
    path: 'src/db/ssoAccountLifecycle.integration.test.ts',
    executionOwner: 'db',
    shard: 'db-sso-account-lifecycle',
    order: 13,
    databaseState:
      'canonical46-account-lifecycle-current-capability-active-canonical-65',
    connectionRole: 'owner',
    requiredEnvironment: [
      'DATABASE_URL',
      'TEST_APP_FIXTURE_DATABASE_URL',
      'ADMIN_DATABASE_URL'
    ],
    seedPolicy: 'canonical-once',
    isolation:
      'existing runner-owned disposable TEST schema; exact3; SQL-only proofs; no external OAuth'
  },
  {
    path: 'src/db/adminCmsFoundation.integration.test.ts',
    executionOwner: 'db',
    shard: 'db-current',
    order: 1,
    databaseState: 'current-capability-active-canonical-65',
    connectionRole: 'owner',
    requiredEnvironment: ['MIGRATION_DATABASE_URL'],
    seedPolicy: 'canonical-once',
    isolation: 'dedicated DB schema and canonical roles'
  },
  {
    path: 'src/db/reauthenticationFoundation.integration.test.ts',
    executionOwner: 'db',
    shard: 'db-current',
    order: 2,
    databaseState: 'current-capability-active-canonical-65',
    connectionRole: 'owner',
    requiredEnvironment: ['TEST_APP_FIXTURE_DATABASE_URL'],
    seedPolicy: 'canonical-once',
    isolation: 'dedicated DB schema and canonical roles'
  },
  {
    path: 'src/db/reauthenticationService.integration.test.ts',
    executionOwner: 'db',
    shard: 'db-current',
    order: 3,
    databaseState: 'current-capability-active-canonical-65',
    connectionRole: 'owner',
    requiredEnvironment: ['TEST_APP_FIXTURE_DATABASE_URL'],
    seedPolicy: 'canonical-once',
    isolation: 'dedicated DB schema and canonical roles'
  },
  {
    path: 'src/dashboard/dashboardInsights.integration.test.ts',
    executionOwner: 'db',
    shard: 'db-current',
    order: 4,
    databaseState: 'current-capability-active-canonical-65',
    connectionRole: 'application',
    requiredEnvironment: ['DATABASE_URL'],
    seedPolicy: 'canonical-once',
    isolation: 'dedicated DB schema and canonical roles'
  },
  {
    path: 'src/dashboard/dashboardInsightsPerformance.integration.test.ts',
    executionOwner: 'db',
    shard: 'db-current',
    order: 5,
    databaseState: 'current-capability-active-canonical-65',
    connectionRole: 'application',
    requiredEnvironment: ['DATABASE_URL'],
    seedPolicy: 'canonical-once',
    isolation: 'dedicated DB schema and canonical roles'
  },
  {
    path: 'src/app/createApp.integration.test.ts',
    executionOwner: 'shard',
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
    executionOwner: 'shard',
    shard: 'current-zero-facts',
    order: 2,
    databaseState: 'current-canonical-65-zero-learner-facts',
    connectionRole: 'application',
    requiredEnvironment: ['DATABASE_URL'],
    seedPolicy: 'canonical-once',
    isolation: 'dedicated schema before learner writes'
  },
  {
    path: 'src/question/questionCatalog.integration.test.ts',
    executionOwner: 'shard',
    shard: 'catalog-baseline',
    order: 4,
    databaseState: 'current-canonical-65',
    connectionRole: 'application',
    requiredEnvironment: [
      'DATABASE_URL',
      'API_INTEGRATION_FIXTURE_DATABASE_URL'
    ],
    seedPolicy: 'canonical-once',
    isolation:
      'runs before any learner writes; owner is limited to rollback-only invariant probes'
  },
  {
    path: 'src/db/studySubmissionIntegrity.integration.test.ts',
    executionOwner: 'shard',
    shard: 'current-app-role',
    order: 5,
    databaseState: 'current-canonical-65',
    connectionRole: 'application',
    requiredEnvironment: [
      'DATABASE_URL',
      'API_INTEGRATION_FIXTURE_DATABASE_URL',
      'TEST_APP_FIXTURE_DATABASE_URL'
    ],
    seedPolicy: 'canonical-once',
    isolation: 'dedicated schema'
  },
  {
    path: 'src/report/userReport.integration.test.ts',
    executionOwner: 'shard',
    shard: 'current-app-role',
    order: 25,
    databaseState: 'current-canonical-65',
    connectionRole: 'application',
    requiredEnvironment: [
      'DATABASE_URL',
      'API_INTEGRATION_FIXTURE_DATABASE_URL',
      'TEST_APP_FIXTURE_DATABASE_URL'
    ],
    seedPolicy: 'canonical-once',
    isolation: 'dedicated schema'
  },
  {
    path: 'src/account/accountRestriction.integration.test.ts',
    executionOwner: 'shard',
    shard: 'current-app-role',
    order: 26,
    databaseState: 'current-canonical-65',
    connectionRole: 'application',
    requiredEnvironment: [
      'DATABASE_URL',
      'API_INTEGRATION_FIXTURE_DATABASE_URL',
      'TEST_APP_FIXTURE_DATABASE_URL'
    ],
    seedPolicy: 'canonical-once',
    isolation: 'dedicated schema'
  },
  {
    path: 'src/report/userReportRetention.integration.test.ts',
    executionOwner: 'shard',
    shard: 'current-app-role',
    order: 27,
    databaseState: 'current-canonical-65',
    connectionRole: 'application',
    requiredEnvironment: [
      'DATABASE_URL',
      'API_INTEGRATION_FIXTURE_DATABASE_URL',
      'TEST_APP_FIXTURE_DATABASE_URL'
    ],
    seedPolicy: 'canonical-once',
    isolation: 'dedicated schema'
  },
  {
    path: 'src/admin/adminMember.integration.test.ts',
    executionOwner: 'shard',
    shard: 'current-app-role',
    order: 28,
    databaseState: 'current-canonical-65',
    connectionRole: 'application',
    requiredEnvironment: [
      'DATABASE_URL',
      'API_INTEGRATION_FIXTURE_DATABASE_URL',
      'TEST_APP_FIXTURE_DATABASE_URL'
    ],
    seedPolicy: 'canonical-once',
    isolation: 'dedicated schema'
  },
  {
    // Last in the shard: it publishes the 500 question set (JLP-828).
    path: 'src/content/questionSetPublish.integration.test.ts',
    executionOwner: 'shard',
    shard: 'current-app-role',
    order: 29,
    databaseState: 'current-canonical-65',
    connectionRole: 'application',
    requiredEnvironment: [
      'DATABASE_URL',
      'API_INTEGRATION_FIXTURE_DATABASE_URL',
      'TEST_APP_FIXTURE_DATABASE_URL'
    ],
    seedPolicy: 'canonical-once',
    isolation: 'dedicated schema'
  },
  {
    path: 'src/study/studySessionCleanup.integration.test.ts',
    executionOwner: 'shard',
    shard: 'current-app-role',
    order: 6,
    databaseState: 'current-canonical-65',
    connectionRole: 'application',
    requiredEnvironment: [
      'DATABASE_URL',
      'API_INTEGRATION_FIXTURE_DATABASE_URL',
      'TEST_APP_FIXTURE_DATABASE_URL'
    ],
    seedPolicy: 'canonical-once',
    isolation: 'dedicated schema'
  },
  ...[
    'study/studyDraft.integration.test.ts',
    'study/studyDraftCleanup.integration.test.ts',
    'study/studyDraftQueryPlan.integration.test.ts',
    'study/studySelectionQueryPlan.integration.test.ts',
    'study/studySessionMigration.integration.test.ts'
  ].map((relativePath, index) => ({
    path: `src/${relativePath}` as `src/${string}.integration.test.ts`,
    executionOwner: 'shard' as const,
    shard: 'current-app-role-with-owner-fixtures',
    order: 7 + index,
    databaseState: 'current-canonical-65',
    connectionRole: 'application' as const,
    requiredEnvironment: [
      'DATABASE_URL',
      'API_INTEGRATION_FIXTURE_DATABASE_URL',
      'TEST_APP_FIXTURE_DATABASE_URL'
    ],
    seedPolicy: 'canonical-once' as const,
    isolation: 'dedicated schema; owner only for fixture setup'
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
    executionOwner: 'shard' as const,
    shard: 'current-rebased-service',
    order: 12 + index,
    databaseState: 'current-canonical-65',
    connectionRole: 'application' as const,
    requiredEnvironment:
      relativePath === 'auth/auth.integration.test.ts' ||
      relativePath === 'study/studySession.integration.test.ts'
        ? [
            'DATABASE_URL',
            'API_INTEGRATION_FIXTURE_DATABASE_URL',
            'TEST_APP_FIXTURE_DATABASE_URL'
          ]
        : [
            'DATABASE_URL',
            'API_INTEGRATION_FIXTURE_DATABASE_URL',
            'TEST_APP_FIXTURE_DATABASE_URL'
          ],
    seedPolicy: 'canonical-once' as const,
    isolation: 'disposable fixture aggregate in dedicated schema'
  }))
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
