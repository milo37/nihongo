import { createRequire } from 'node:module'

const requireFromApi = createRequire(
  new URL('../apps/api/package.json', import.meta.url)
)
const { Client } = requireFromApi('pg')

const SAFE_SCHEMA_PATTERN = /^phase7_[a-f0-9]{32}_test$/u
const SHA256_PATTERN = /^[a-f0-9]{64}$/u

export const phase9DatabaseTables = [
  'Account',
  'AdminAuditLog',
  'AuthIssuerActivation',
  'AuthSessionFamily',
  'AuthSessionRotationFence',
  'Bookmark',
  'ContentReview',
  'GuestPrincipal',
  'IdempotencyRecord',
  'Phase7AuthorityRevocationEvidence',
  'Phase7DatabaseCapability',
  'Phase7OperationDelta',
  'Phase7OperationIntent',
  'Phase7ReauthenticationIntent',
  'Phase7TrustedExecution',
  'Question',
  'QuestionOption',
  'QuestionReport',
  'QuestionVersion',
  'QuestionVersionTag',
  'RateLimit',
  'ReviewEvent',
  'ReviewSchedule',
  'Session',
  'StudyAnswer',
  'StudyDraft',
  'StudyDraftAnswer',
  'StudyResult',
  'StudySession',
  'StudySessionQuestion',
  'Tag',
  'TagApplicability',
  'User',
  'UserMemo',
  'Verification',
  'WrongNote',
  '_prisma_migrations'
]

export const phase9ExpectedTableDeltas = {
  Account: 0,
  AdminAuditLog: 0,
  AuthIssuerActivation: 0,
  AuthSessionFamily: 2,
  AuthSessionRotationFence: 0,
  Bookmark: 0,
  ContentReview: 0,
  GuestPrincipal: 0,
  IdempotencyRecord: 4,
  Phase7AuthorityRevocationEvidence: 0,
  Phase7DatabaseCapability: 0,
  Phase7OperationDelta: 0,
  Phase7OperationIntent: 0,
  Phase7ReauthenticationIntent: 0,
  Phase7TrustedExecution: 0,
  Question: 0,
  QuestionOption: 0,
  QuestionReport: 1,
  QuestionVersion: 0,
  QuestionVersionTag: 0,
  RateLimit: 22,
  ReviewEvent: 10,
  ReviewSchedule: 10,
  Session: 2,
  StudyAnswer: 10,
  StudyDraft: 1,
  StudyDraftAnswer: 3,
  StudyResult: 2,
  StudySession: 3,
  StudySessionQuestion: 13,
  Tag: 0,
  TagApplicability: 0,
  User: 0,
  UserMemo: 0,
  Verification: 0,
  WrongNote: 10,
  _prisma_migrations: 0
}

const expectedRateLimitCategories = {
  'application:bookmark-list': 1,
  'application:bookmark-write': 1,
  'application:dashboard-insights-read': 1,
  'application:dashboard-read': 1,
  'application:phase7:ADMIN_READ:ACTOR': 1,
  'application:phase7:ADMIN_READ:IP': 1,
  'application:phase7:REPORT_ACTOR:ACTOR': 1,
  'application:phase7:REPORT_ACTOR:IP': 1,
  'application:phase7:REPORT_VERSION:VERSION': 1,
  'application:study-create': 2,
  'application:study-read': 1,
  'application:study-result-read': 1,
  'application:study-submit': 2,
  'application:wrong-note-detail': 1,
  'application:wrong-note-history': 1,
  'application:wrong-note-list': 1,
  'application:wrong-note-memo-read': 1,
  'application:wrong-note-review-queue': 1,
  'application:auth:/api/auth/sign-in/email': 2
}

const sorted = (values) =>
  [...values].sort((left, right) => left.localeCompare(right))

const fail = (message) => {
  throw new Error(`Phase 9 database contract: ${message}`)
}

const assertEqual = (actual, expected, label) => {
  if (actual !== expected) {
    fail(
      `${label}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`
    )
  }
}

const canonicalizeJson = (value) => {
  if (Array.isArray(value)) return value.map(canonicalizeJson)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalizeJson(entry)])
  )
}

const assertJsonEqual = (actual, expected, label) => {
  if (
    JSON.stringify(canonicalizeJson(actual)) !==
    JSON.stringify(canonicalizeJson(expected))
  ) {
    fail(
      `${label}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`
    )
  }
}

const parseDatabaseTarget = (databaseUrl) => {
  const url = new URL(databaseUrl)
  const schemas = url.searchParams.getAll('schema')
  const schemaName = schemas.length === 1 ? schemas[0] : undefined
  if (!schemaName || !SAFE_SCHEMA_PATTERN.test(schemaName)) {
    fail('refusing to inspect an unsafe or missing isolated schema')
  }
  url.searchParams.delete('schema')
  url.searchParams.delete('options')
  return { connectionString: url.toString(), schemaName }
}

const createClient = ({ connectionString, schemaName }) =>
  new Client({
    connectionString,
    options: `-c search_path=${schemaName} -c TimeZone=UTC`
  })

const withClient = async (databaseUrl, operation) => {
  const target = parseDatabaseTarget(databaseUrl)
  const client = createClient(target)
  await client.connect()
  try {
    return await operation(client, target.schemaName)
  } finally {
    await client.end()
  }
}

const quoteIdentifier = (value) => `"${value.replaceAll('"', '""')}"`

const readTableSnapshot = async (client, schemaName, tableName) => {
  const result = await client.query(
    `SELECT COUNT(*)::int AS "count",
       encode(
         public.digest(
           COALESCE(
             string_agg("rowJson", E'\\n' ORDER BY "rowJson" COLLATE "C"),
             ''
           ),
           'sha256'
         ),
         'hex'
       ) AS "fingerprint"
     FROM (
       SELECT to_jsonb(source_row)::text AS "rowJson"
       FROM ${quoteIdentifier(schemaName)}.${quoteIdentifier(tableName)} AS source_row
     ) AS snapshot_rows`
  )
  const row = result.rows[0]
  if (
    !row ||
    !Number.isSafeInteger(row.count) ||
    row.count < 0 ||
    !SHA256_PATTERN.test(row.fingerprint)
  ) {
    fail(`invalid snapshot for ${tableName}`)
  }
  return row
}

const readSnapshot = async (client, schemaName) => {
  const actualTablesResult = await client.query(
    `SELECT table_name AS "tableName"
     FROM information_schema.tables
     WHERE table_schema = $1 AND table_type = 'BASE TABLE'
     ORDER BY table_name`,
    [schemaName]
  )
  const tableNames = actualTablesResult.rows.map(({ tableName }) => tableName)
  const tables = {}
  for (const tableName of phase9DatabaseTables) {
    tables[tableName] = await readTableSnapshot(client, schemaName, tableName)
  }
  const rateLimitResult = await client.query(
    `SELECT "key", "count" FROM "RateLimit" ORDER BY "key"`
  )
  return {
    rateLimitRows: rateLimitResult.rows,
    tableNames,
    tables
  }
}

const inReadOnlySnapshot = async (client, operation) => {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
  try {
    const result = await operation()
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  }
}

export const capturePhase9DatabaseSnapshot = async (databaseUrl) =>
  await withClient(
    databaseUrl,
    async (client, schemaName) =>
      await inReadOnlySnapshot(
        client,
        async () => await readSnapshot(client, schemaName)
      )
  )

export const assertPhase9SnapshotContract = (before, after) => {
  const expectedTables = sorted(phase9DatabaseTables)
  assertJsonEqual(
    sorted(before.tableNames),
    expectedTables,
    'baseline table inventory'
  )
  assertJsonEqual(
    sorted(after.tableNames),
    expectedTables,
    'final table inventory'
  )
  assertJsonEqual(
    sorted(Object.keys(before.tables)),
    expectedTables,
    'baseline snapshot inventory'
  )
  assertJsonEqual(
    sorted(Object.keys(after.tables)),
    expectedTables,
    'final snapshot inventory'
  )
  assertJsonEqual(
    sorted(Object.keys(phase9ExpectedTableDeltas)),
    expectedTables,
    'expected delta inventory'
  )

  for (const tableName of phase9DatabaseTables) {
    const baseline = before.tables[tableName]
    const final = after.tables[tableName]
    if (!baseline || !final) fail(`missing ${tableName} snapshot`)
    const expectedDelta = phase9ExpectedTableDeltas[tableName]
    assertEqual(
      final.count - baseline.count,
      expectedDelta,
      `${tableName} count delta`
    )
    if (expectedDelta === 0) {
      assertEqual(
        final.fingerprint,
        baseline.fingerprint,
        `${tableName} zero-delta fingerprint`
      )
    }
  }
}

const readIdentityFacts = async (client, fixture) => {
  const actorIds = [
    fixture.author.userId,
    fixture.insightsLearner.userId,
    fixture.learner.userId,
    fixture.reviewer.userId
  ]
  const authSessions = await client.query(
    `SELECT s."userId", s."authorizationState", s."issuerProtocolVersion",
       f."status" AS "familyStatus"
     FROM "Session" AS s
     JOIN "AuthSessionFamily" AS f
       ON f."userId" = s."userId" AND f."id" = s."sessionFamilyId"
     WHERE s."userId" = ANY($1::uuid[])
     ORDER BY s."userId", s."id"`,
    [actorIds]
  )
  const studySessions = await client.query(
    `SELECT ss."id", ss."userId", ss."subject", ss."status",
       ss."requestedCount", ss."actualCount", ss."usedFallback",
       ss."practiceContractVersion",
       (SELECT COUNT(*)::int FROM "StudySessionQuestion" AS q
        WHERE q."studySessionId" = ss."id") AS "questionCount",
       (SELECT COUNT(*)::int FROM "StudyAnswer" AS a
        JOIN "StudySessionQuestion" AS q
          ON q."id" = a."studySessionQuestionId"
        WHERE q."studySessionId" = ss."id") AS "answerCount",
       (SELECT COUNT(*)::int FROM "StudyResult" AS r
        WHERE r."studySessionId" = ss."id") AS "resultCount",
       (SELECT COUNT(*)::int FROM "WrongNote" AS w
        WHERE w."userId" = ss."userId"
          AND EXISTS (
            SELECT 1 FROM "StudySessionQuestion" AS q
            WHERE q."studySessionId" = ss."id"
              AND q."questionId" = w."questionId"
          )) AS "wrongNoteCount",
       (SELECT COUNT(*)::int FROM "ReviewSchedule" AS schedule
        JOIN "WrongNote" AS w ON w."id" = schedule."wrongNoteId"
        WHERE w."userId" = ss."userId"
          AND EXISTS (
            SELECT 1 FROM "StudySessionQuestion" AS q
            WHERE q."studySessionId" = ss."id"
              AND q."questionId" = w."questionId"
          )) AS "scheduleCount",
       (SELECT COUNT(*)::int FROM "ReviewEvent" AS event
        WHERE event."studySessionId" = ss."id"
          AND event."source" = 'STUDY_SUBMIT') AS "reviewEventCount"
     FROM "StudySession" AS ss
     WHERE ss."userId" = ANY($1::uuid[])
     ORDER BY ss."userId", ss."subject", ss."id"`,
    [actorIds]
  )
  const drafts = await client.query(
    `SELECT d."studySessionId", d."revision", d."currentOrdinal",
       COUNT(a.*)::int AS "answerCount",
       COUNT(a."selectedOptionId")::int AS "selectedAnswerCount"
     FROM "StudyDraft" AS d
     JOIN "StudySession" AS ss ON ss."id" = d."studySessionId"
     LEFT JOIN "StudyDraftAnswer" AS a
       ON a."studySessionId" = d."studySessionId"
     WHERE ss."userId" = ANY($1::uuid[])
     GROUP BY d."studySessionId", d."revision", d."currentOrdinal"
     ORDER BY d."studySessionId"`,
    [actorIds]
  )
  const reports = await client.query(
    `SELECT report."reporterUserId", report."reason", report."status",
       report."rowVersion",
       EXISTS (
         SELECT 1
         FROM "StudySession" AS ss
         JOIN "StudySessionQuestion" AS q ON q."studySessionId" = ss."id"
         WHERE ss."userId" = $1::uuid
           AND q."questionId" = report."questionId"
           AND q."questionVersionId" = report."questionVersionId"
       ) AS "targetInAuthorSession"
     FROM "QuestionReport" AS report
     WHERE report."reporterUserId" = ANY($2::uuid[])
     ORDER BY report."id"`,
    [fixture.author.userId, actorIds]
  )
  const bookmarks = await client.query(
    `SELECT COUNT(*)::int AS "count"
     FROM "Bookmark"
     WHERE "userId" = ANY($1::uuid[])`,
    [actorIds]
  )
  const idempotencyRecords = await client.query(
    `SELECT "userId", "studySessionId", "operation", "state",
       "responseStatus", "contractVersion", COUNT(*)::int AS "count"
     FROM "IdempotencyRecord"
     WHERE "userId" = ANY($1::uuid[])
     GROUP BY "userId", "studySessionId", "operation", "state",
       "responseStatus", "contractVersion"
     ORDER BY "userId", "studySessionId", "operation"`,
    [actorIds]
  )
  return {
    authSessions: authSessions.rows,
    bookmarkCount: bookmarks.rows[0]?.count,
    drafts: drafts.rows,
    idempotencyRecords: idempotencyRecords.rows,
    reports: reports.rows,
    studySessions: studySessions.rows
  }
}

const rateLimitCategory = (key) => {
  const digestMatch = /^(.*):([a-f0-9]{64})$/u.exec(key)
  if (!digestMatch)
    fail(`unexpected rate-limit key shape ${JSON.stringify(key)}`)
  return digestMatch[1]
}

const assertRateLimitContract = (before, after) => {
  const beforeKeys = new Set(before.rateLimitRows.map(({ key }) => key))
  const newRows = after.rateLimitRows.filter(({ key }) => !beforeKeys.has(key))
  assertEqual(newRows.length, 22, 'new rate-limit key count')
  const categories = Object.fromEntries(
    Object.keys(expectedRateLimitCategories).map((category) => [category, 0])
  )
  for (const row of newRows) {
    const category = rateLimitCategory(row.key)
    if (!(category in categories))
      fail(`unexpected rate-limit category ${category}`)
    if (!Number.isSafeInteger(row.count) || row.count < 1) {
      fail(`invalid rate-limit count for ${category}`)
    }
    categories[category] += 1
  }
  assertJsonEqual(
    categories,
    expectedRateLimitCategories,
    'rate-limit categories'
  )
  return categories
}

const assertIdentityContract = (facts, fixture) => {
  const expectedAuthUsers = sorted([
    fixture.author.userId,
    fixture.learner.userId
  ])
  assertJsonEqual(
    sorted(facts.authSessions.map(({ userId }) => userId)),
    expectedAuthUsers,
    'authenticated actor identities'
  )
  for (const session of facts.authSessions) {
    assertEqual(
      session.authorizationState,
      'ACTIVE',
      'auth authorization state'
    )
    assertEqual(session.issuerProtocolVersion, 'PHASE7_V1', 'auth issuer')
    assertEqual(session.familyStatus, 'ACTIVE', 'auth family state')
  }

  assertEqual(facts.studySessions.length, 3, 'study session identity count')
  const learnerVocabulary = facts.studySessions.find(
    (session) =>
      session.userId === fixture.learner.userId &&
      session.subject === 'VOCABULARY'
  )
  const learnerReading = facts.studySessions.find(
    (session) =>
      session.userId === fixture.learner.userId && session.subject === 'READING'
  )
  const authorVocabulary = facts.studySessions.find(
    (session) =>
      session.userId === fixture.author.userId &&
      session.subject === 'VOCABULARY'
  )
  for (const [label, session] of [
    ['learner vocabulary', learnerVocabulary],
    ['author vocabulary', authorVocabulary]
  ]) {
    if (!session) fail(`missing ${label} session`)
    const projection = {
      actualCount: session.actualCount,
      answerCount: session.answerCount,
      contract: session.practiceContractVersion,
      questionCount: session.questionCount,
      requestedCount: session.requestedCount,
      resultCount: session.resultCount,
      reviewEventCount: session.reviewEventCount,
      scheduleCount: session.scheduleCount,
      status: session.status,
      usedFallback: session.usedFallback,
      wrongNoteCount: session.wrongNoteCount
    }
    assertJsonEqual(
      projection,
      {
        actualCount: 5,
        answerCount: 5,
        contract: 2,
        questionCount: 5,
        requestedCount: 5,
        resultCount: 1,
        reviewEventCount: 5,
        scheduleCount: 5,
        status: 'SUBMITTED',
        usedFallback: false,
        wrongNoteCount: 5
      },
      `${label} state`
    )
  }
  if (!learnerReading) fail('missing learner reading session')
  assertJsonEqual(
    {
      actualCount: learnerReading.actualCount,
      answerCount: learnerReading.answerCount,
      contract: learnerReading.practiceContractVersion,
      questionCount: learnerReading.questionCount,
      requestedCount: learnerReading.requestedCount,
      resultCount: learnerReading.resultCount,
      reviewEventCount: learnerReading.reviewEventCount,
      scheduleCount: learnerReading.scheduleCount,
      status: learnerReading.status,
      usedFallback: learnerReading.usedFallback,
      wrongNoteCount: learnerReading.wrongNoteCount
    },
    {
      actualCount: 3,
      answerCount: 0,
      contract: 2,
      questionCount: 3,
      requestedCount: 5,
      resultCount: 0,
      reviewEventCount: 0,
      scheduleCount: 0,
      status: 'IN_PROGRESS',
      usedFallback: false,
      wrongNoteCount: 0
    },
    'learner reading state'
  )
  assertJsonEqual(
    facts.drafts,
    [
      {
        answerCount: 3,
        currentOrdinal: 1,
        revision: 1,
        selectedAnswerCount: 1,
        studySessionId: learnerReading.id
      }
    ],
    'reading draft state'
  )
  assertEqual(facts.bookmarkCount, 0, 'final bookmark count')
  assertJsonEqual(
    facts.reports,
    [
      {
        reason: 'OTHER',
        reporterUserId: fixture.author.userId,
        rowVersion: 1,
        status: 'OPEN',
        targetInAuthorSession: true
      }
    ],
    'question report identity'
  )

  const compareIdempotency = (left, right) =>
    left.userId.localeCompare(right.userId) ||
    left.studySessionId.localeCompare(right.studySessionId) ||
    left.operation.localeCompare(right.operation)
  const idempotencyProjection = facts.idempotencyRecords
    .map((record) => ({
      contractVersion: record.contractVersion,
      count: record.count,
      operation: record.operation,
      responseStatus: record.responseStatus,
      state: record.state,
      studySessionId: record.studySessionId,
      userId: record.userId
    }))
    .sort(compareIdempotency)
  const expectedIdempotency = [
    {
      contractVersion: 2,
      count: 1,
      operation: 'STUDY_SUBMIT',
      responseStatus: 201,
      state: 'SUCCEEDED',
      studySessionId: authorVocabulary.id,
      userId: fixture.author.userId
    },
    {
      contractVersion: 2,
      count: 1,
      operation: 'STUDY_DRAFT_SAVE',
      responseStatus: 200,
      state: 'SUCCEEDED',
      studySessionId: learnerReading.id,
      userId: fixture.learner.userId
    },
    {
      contractVersion: 2,
      count: 1,
      operation: 'STUDY_DRAFT_SAVE',
      responseStatus: 200,
      state: 'SUCCEEDED',
      studySessionId: learnerVocabulary.id,
      userId: fixture.learner.userId
    },
    {
      contractVersion: 2,
      count: 1,
      operation: 'STUDY_SUBMIT',
      responseStatus: 201,
      state: 'SUCCEEDED',
      studySessionId: learnerVocabulary.id,
      userId: fixture.learner.userId
    }
  ].sort(compareIdempotency)
  assertJsonEqual(
    idempotencyProjection,
    expectedIdempotency,
    'idempotency identities'
  )
}

export const assertPhase9DatabaseContract = async ({
  before,
  databaseUrl,
  fixture
}) =>
  await withClient(databaseUrl, async (client, schemaName) => {
    return await inReadOnlySnapshot(client, async () => {
      const after = await readSnapshot(client, schemaName)
      assertPhase9SnapshotContract(before, after)
      const facts = await readIdentityFacts(client, fixture)
      assertIdentityContract(facts, fixture)
      const rateLimitCategories = assertRateLimitContract(before, after)
      return {
        actorState: {
          authSessions: facts.authSessions.length,
          bookmarks: facts.bookmarkCount,
          idempotencyRecords: facts.idempotencyRecords.reduce(
            (total, record) => total + record.count,
            0
          ),
          reports: facts.reports.length,
          studySessions: facts.studySessions.map((session) => ({
            actualCount: session.actualCount,
            requestedCount: session.requestedCount,
            status: session.status,
            subject: session.subject,
            userId: session.userId
          }))
        },
        rateLimitCategories,
        tableDeltas: Object.fromEntries(
          phase9DatabaseTables.map((tableName) => [
            tableName,
            after.tables[tableName].count - before.tables[tableName].count
          ])
        ),
        zeroDeltaFingerprintsVerified: phase9DatabaseTables.filter(
          (tableName) => phase9ExpectedTableDeltas[tableName] === 0
        ).length
      }
    })
  })
