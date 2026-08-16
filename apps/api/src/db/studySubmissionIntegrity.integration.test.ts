import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseApiEnvironment } from '../config/env.js'
import { createDatabaseRuntime } from './database.js'
import { getPostgresSchema } from './databaseOptions.js'
import { assertSafeTestDatabase } from './databaseTargetGuard.js'

const DAY_MS = 24 * 60 * 60 * 1_000
const HOUR_MS = 60 * 60 * 1_000
const GRADING_VERSION = 'server-grading-v1'

interface QuestionFixture {
  readonly correctOptionId: string
  readonly questionId: string
  readonly questionVersionId: string
}

interface SessionFixture {
  readonly id: string
  readonly itemId: string
  readonly startedAt: Date
}

const environment = parseApiEnvironment(process.env)
assertSafeTestDatabase({
  nodeEnvironment: environment.NODE_ENV,
  databaseUrl: environment.DATABASE_URL,
  productionDatabaseUrl: process.env.PRODUCTION_DATABASE_URL
})
const schema = getPostgresSchema(environment.DATABASE_URL)
if (!schema) {
  throw new Error('Study submission integrity test schema가 필요합니다.')
}

const database = createDatabaseRuntime(environment.DATABASE_URL)
const client = new Client({
  connectionString: environment.DATABASE_URL,
  options: `-c search_path=${schema}`
})
const createdUserIds = new Set<string>()
const createdGuestIds = new Set<string>()

const addMilliseconds = (date: Date, value: number): Date =>
  new Date(date.getTime() + value)
const createHash = (): string =>
  `${randomUUID().replaceAll('-', '')}${randomUUID().replaceAll('-', '')}`

const transaction = async <T>(work: () => Promise<T>): Promise<T> => {
  await client.query('BEGIN')
  try {
    const result = await work()
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  }
}

const createUser = async (label: string): Promise<string> => {
  const id = randomUUID()
  await client.query(
    `INSERT INTO "User" (
      "id", "name", "email", "emailVerified", "role", "accountStatus",
      "createdAt", "updatedAt"
    ) VALUES ($1, $2, $3, true, 'USER', 'ACTIVE', now(), now())`,
    [
      id,
      `Slice4 integrity ${label}`,
      `slice4-integrity-${randomUUID()}@example.test`
    ]
  )
  createdUserIds.add(id)
  return id
}

const loadQuestion = async (): Promise<QuestionFixture> => {
  const result = await client.query<QuestionFixture>(
    `SELECT
      question."id" AS "questionId",
      version."id" AS "questionVersionId",
      version."correctOptionId" AS "correctOptionId"
    FROM "Question" AS question
    JOIN "QuestionVersion" AS version
      ON version."questionId" = question."id"
      AND version."id" = question."currentPublishedVersionId"
    WHERE question."lifecycleStatus" = 'ACTIVE'
      AND version."status" = 'PUBLISHED'
      AND version."level" = 'N5'
      AND version."subject" = 'VOCABULARY'
      AND version."correctOptionId" IS NOT NULL
    ORDER BY question."id"
    LIMIT 1`
  )
  const question = result.rows[0]
  if (!question) {
    throw new Error('Published question fixture가 필요합니다.')
  }
  return question
}

const createSession = async (
  userId: string,
  question: QuestionFixture,
  startedAt: Date
): Promise<SessionFixture> => {
  const id = randomUUID()
  const itemId = randomUUID()
  await transaction(async () => {
    await client.query(
      `INSERT INTO "StudySession" (
        "id", "userId", "level", "subject", "mode", "status",
        "requestedCount", "actualCount", "usedFallback", "startedAt",
        "expiresAt", "createdAt", "updatedAt"
      ) VALUES (
        $1, $2, 'N5', 'VOCABULARY', 'RANDOM', 'IN_PROGRESS',
        1, 1, false, $3, $4, $3, $3
      )`,
      [id, userId, startedAt, addMilliseconds(startedAt, 7 * DAY_MS)]
    )
    await client.query(
      `INSERT INTO "StudySessionQuestion" (
        "id", "studySessionId", "questionId", "questionVersionId",
        "ordinal", "createdAt"
      ) VALUES ($1, $2, $3, $4, 1, $5)`,
      [itemId, id, question.questionId, question.questionVersionId, startedAt]
    )
  })
  return { id, itemId, startedAt }
}

const insertProcessing = async (
  id: string,
  sessionId: string,
  userId: string,
  requestHash: string,
  createdAt: Date
): Promise<void> => {
  await client.query(
    `INSERT INTO "IdempotencyRecord" (
      "id", "principalType", "userId", "operation", "idempotencyKey",
      "studySessionId", "requestHash", "state", "createdAt"
    ) VALUES (
      $1, 'USER', $2, 'STUDY_SUBMIT', $3, $4, $5, 'PROCESSING', $6
    )`,
    [id, userId, randomUUID(), sessionId, requestHash, createdAt]
  )
}

const finalizeSession = async (
  recordId: string,
  session: SessionFixture,
  requestHash: string,
  occurredAt: Date,
  correctCount: 0 | 1
): Promise<void> => {
  const durationSec = Math.floor(
    (occurredAt.getTime() - session.startedAt.getTime()) / 1_000
  )
  await client.query(
    `INSERT INTO "StudyResult" (
      "id", "studySessionId", "totalCount", "correctCount",
      "incorrectCount", "correctRateBasisPoints", "durationSec",
      "gradingVersion", "createdAt"
    ) VALUES ($1, $2, 1, $3, $4, $5, $6, $7, $8)`,
    [
      randomUUID(),
      session.id,
      correctCount,
      1 - correctCount,
      correctCount * 10_000,
      durationSec,
      GRADING_VERSION,
      occurredAt
    ]
  )
  await client.query(
    `UPDATE "StudySession"
     SET "status" = 'SUBMITTED', "submittedAt" = $2,
         "durationSec" = $3, "submissionHash" = $4, "updatedAt" = $2
     WHERE "id" = $1`,
    [session.id, occurredAt, durationSec, requestHash]
  )
  await client.query(
    `UPDATE "IdempotencyRecord"
     SET "state" = 'SUCCEEDED', "responseStatus" = 201,
         "responseBody" = $2::jsonb, "completedAt" = $3, "expiresAt" = $4
     WHERE "id" = $1`,
    [
      recordId,
      JSON.stringify({ sessionId: session.id }),
      occurredAt,
      addMilliseconds(occurredAt, DAY_MS)
    ]
  )
}

const createInitialWrongNote = async (
  userId: string,
  question: QuestionFixture,
  occurredAt: Date
): Promise<{
  readonly eventId: string
  readonly noteId: string
  readonly session: SessionFixture
}> => {
  const session = await createSession(
    userId,
    question,
    addMilliseconds(occurredAt, -HOUR_MS)
  )
  const recordId = randomUUID()
  const answerId = randomUUID()
  const noteId = randomUUID()
  const eventId = randomUUID()
  const requestHash = createHash()

  await transaction(async () => {
    await insertProcessing(
      recordId,
      session.id,
      userId,
      requestHash,
      addMilliseconds(occurredAt, -1_000)
    )
    await client.query(
      `INSERT INTO "StudyAnswer" (
        "id", "studySessionQuestionId", "questionVersionId",
        "selectedOptionId", "isCorrect", "elapsedSec", "gradingVersion",
        "answeredAt", "gradedAt"
      ) VALUES ($1, $2, $3, NULL, false, 1, $4, $5, $5)`,
      [
        answerId,
        session.itemId,
        question.questionVersionId,
        GRADING_VERSION,
        occurredAt
      ]
    )
    await client.query(
      `INSERT INTO "WrongNote" (
        "id", "userId", "questionId", "lastWrongQuestionVersionId",
        "currentReviewQuestionVersionId", "wrongCount", "correctStreak",
        "status", "lastWrongAt", "lastReviewedAt", "createdAt", "updatedAt"
      ) VALUES (
        $1, $2, $3, $4, NULL, 1, 0, 'NEW', $5, NULL, $5, $5
      )`,
      [
        noteId,
        userId,
        question.questionId,
        question.questionVersionId,
        occurredAt
      ]
    )
    await client.query(
      `INSERT INTO "ReviewSchedule" (
        "id", "wrongNoteId", "nextReviewAt", "intervalDays",
        "algorithmVersion", "updatedAt"
      ) VALUES ($1, $2, $3, 1, 1, $4)`,
      [randomUUID(), noteId, addMilliseconds(occurredAt, DAY_MS), occurredAt]
    )
    await client.query(
      `INSERT INTO "ReviewEvent" (
        "id", "wrongNoteId", "userId", "questionId", "questionVersionId",
        "source", "studySessionId", "studyAnswerId", "selectedOptionId",
        "isCorrect", "previousStatus", "nextStatus",
        "previousCorrectStreak", "nextCorrectStreak",
        "previousWrongCount", "wrongCountAfter", "algorithmVersion",
        "occurredAt"
      ) VALUES (
        $1, $2, $3, $4, $5, 'STUDY_SUBMIT', $6, $7, NULL, false,
        NULL, 'NEW', NULL, 0, NULL, 1, 1, $8
      )`,
      [
        eventId,
        noteId,
        userId,
        question.questionId,
        question.questionVersionId,
        session.id,
        answerId,
        occurredAt
      ]
    )
    await finalizeSession(recordId, session, requestHash, occurredAt, 0)
  })
  return { eventId, noteId, session }
}

const transitionToReviewing = async (
  userId: string,
  question: QuestionFixture,
  noteId: string,
  occurredAt: Date
): Promise<SessionFixture> => {
  const session = await createSession(
    userId,
    question,
    addMilliseconds(occurredAt, -HOUR_MS)
  )
  const recordId = randomUUID()
  const answerId = randomUUID()
  const requestHash = createHash()
  await transaction(async () => {
    await insertProcessing(
      recordId,
      session.id,
      userId,
      requestHash,
      addMilliseconds(occurredAt, -1_000)
    )
    await client.query(
      `INSERT INTO "StudyAnswer" (
        "id", "studySessionQuestionId", "questionVersionId",
        "selectedOptionId", "isCorrect", "elapsedSec", "gradingVersion",
        "answeredAt", "gradedAt"
      ) VALUES ($1, $2, $3, $4, true, 1, $5, $6, $6)`,
      [
        answerId,
        session.itemId,
        question.questionVersionId,
        question.correctOptionId,
        GRADING_VERSION,
        occurredAt
      ]
    )
    await client.query(
      `UPDATE "WrongNote"
       SET "correctStreak" = 1, "status" = 'REVIEWING',
           "lastReviewedAt" = $2, "updatedAt" = $2
       WHERE "id" = $1`,
      [noteId, occurredAt]
    )
    await client.query(
      `UPDATE "ReviewSchedule"
       SET "nextReviewAt" = $2, "intervalDays" = 3, "updatedAt" = $3
       WHERE "wrongNoteId" = $1`,
      [noteId, addMilliseconds(occurredAt, 3 * DAY_MS), occurredAt]
    )
    await client.query(
      `INSERT INTO "ReviewEvent" (
        "id", "wrongNoteId", "userId", "questionId", "questionVersionId",
        "source", "studySessionId", "studyAnswerId", "selectedOptionId",
        "isCorrect", "previousStatus", "nextStatus",
        "previousCorrectStreak", "nextCorrectStreak",
        "previousWrongCount", "wrongCountAfter", "algorithmVersion",
        "occurredAt"
      ) VALUES (
        $1, $2, $3, $4, $5, 'STUDY_SUBMIT', $6, $7, $8, true,
        'NEW', 'REVIEWING', 0, 1, 1, 1, 1, $9
      )`,
      [
        randomUUID(),
        noteId,
        userId,
        question.questionId,
        question.questionVersionId,
        session.id,
        answerId,
        question.correctOptionId,
        occurredAt
      ]
    )
    await finalizeSession(recordId, session, requestHash, occurredAt, 1)
  })
  return session
}

beforeAll(async () => {
  await database.checkReadiness()
  await client.connect()
})

afterAll(async () => {
  for (const userId of createdUserIds) {
    await client
      .query('DELETE FROM "User" WHERE "id" = $1', [userId])
      .catch(() => undefined)
  }
  for (const guestId of createdGuestIds) {
    await client
      .query('DELETE FROM "GuestPrincipal" WHERE "id" = $1', [guestId])
      .catch(() => undefined)
  }
  await client.end()
  await database.disconnect()
})

describe('Slice 4 submission integrity follow-up', () => {
  it('strict idempotency CHECK와 latest-event trigger definitions를 설치한다', async () => {
    const result = await client.query<{
      checkDefinition: string
      eventFunction: string
      snapshotFunction: string
    }>(
      `SELECT
        pg_get_constraintdef(constraint_row.oid) AS "checkDefinition",
        pg_get_functiondef(
          'validate_review_event_change()'::regprocedure
        ) AS "eventFunction",
        pg_get_functiondef(
          'validate_wrong_note_snapshot()'::regprocedure
        ) AS "snapshotFunction"
       FROM pg_constraint AS constraint_row
       WHERE constraint_row.conrelid = '"IdempotencyRecord"'::regclass
         AND constraint_row.conname = 'IdempotencyRecord_state_check'`
    )
    expect(result.rows[0]?.checkDefinition).toContain(
      '"responseStatus" IS NOT NULL'
    )
    expect(result.rows[0]?.checkDefinition).toContain(
      '"responseBody" IS NOT NULL'
    )
    expect(result.rows[0]?.eventFunction).toContain('FOR UPDATE')
    expect(result.rows[0]?.eventFunction).toContain(
      'NEW."previousStatus" IS DISTINCT FROM prior_status'
    )
    expect(result.rows[0]?.snapshotFunction).toContain(
      'ORDER BY event."occurredAt" DESC, event."id" DESC'
    )
  })

  it('SUCCEEDED null status/body를 PostgreSQL CHECK에서 즉시 거부한다', async () => {
    const userId = await createUser('null-shape')
    const question = await loadQuestion()
    const session = await createSession(userId, question, new Date())

    for (const missing of ['status', 'body'] as const) {
      await expect(
        transaction(async () => {
          const id = randomUUID()
          const completedAt = addMilliseconds(new Date(), 1_000)
          await insertProcessing(
            id,
            session.id,
            userId,
            createHash(),
            addMilliseconds(completedAt, -1_000)
          )
          await client.query(
            `UPDATE "IdempotencyRecord"
             SET "state" = 'SUCCEEDED',
                 "responseStatus" = $2,
                 "responseBody" = $3::jsonb,
                 "completedAt" = $4,
                 "expiresAt" = $5
             WHERE "id" = $1`,
            [
              id,
              missing === 'status' ? null : 201,
              missing === 'body'
                ? null
                : JSON.stringify({ sessionId: session.id }),
              completedAt,
              addMilliseconds(completedAt, DAY_MS)
            ]
          )
        })
      ).rejects.toMatchObject({ code: '23514' })
    }
  })

  it('first-correct USER는 note/event 0을 허용하고 session direct delete를 차단한다', async () => {
    const userId = await createUser('first-correct')
    const question = await loadQuestion()
    const occurredAt = new Date()
    const session = await createSession(
      userId,
      question,
      addMilliseconds(occurredAt, -HOUR_MS)
    )
    const recordId = randomUUID()
    const requestHash = createHash()
    await transaction(async () => {
      await insertProcessing(
        recordId,
        session.id,
        userId,
        requestHash,
        addMilliseconds(occurredAt, -1_000)
      )
      await client.query(
        `INSERT INTO "StudyAnswer" (
          "id", "studySessionQuestionId", "questionVersionId",
          "selectedOptionId", "isCorrect", "elapsedSec", "gradingVersion",
          "answeredAt", "gradedAt"
        ) VALUES ($1, $2, $3, $4, true, 1, $5, $6, $6)`,
        [
          randomUUID(),
          session.itemId,
          question.questionVersionId,
          question.correctOptionId,
          GRADING_VERSION,
          occurredAt
        ]
      )
      await finalizeSession(recordId, session, requestHash, occurredAt, 1)
    })

    const evidence = await client.query<{ events: number; notes: number }>(
      `SELECT
        (SELECT COUNT(*)::int FROM "ReviewEvent"
          WHERE "studySessionId" = $1) AS events,
        (SELECT COUNT(*)::int FROM "WrongNote"
          WHERE "userId" = $2) AS notes`,
      [session.id, userId]
    )
    expect(evidence.rows[0]).toEqual({ events: 0, notes: 0 })

    await createInitialWrongNote(userId, question, occurredAt)
    const historical = await client.query<{
      events: number
      notes: number
    }>(
      `SELECT
        (SELECT COUNT(*)::int FROM "ReviewEvent"
          WHERE "studySessionId" = $1) AS events,
        (SELECT COUNT(*)::int FROM "WrongNote"
          WHERE "userId" = $2) AS notes`,
      [session.id, userId]
    )
    expect(historical.rows[0]).toEqual({ events: 0, notes: 1 })

    await expect(
      client.query('DELETE FROM "StudySession" WHERE "id" = $1', [session.id])
    ).rejects.toMatchObject({
      code: '23514',
      message: 'Submitted USER StudySession can only be deleted with its user.'
    })
    await client.query('DELETE FROM "User" WHERE "id" = $1', [userId])
    expect(
      (
        await client.query<{ count: number }>(
          'SELECT COUNT(*)::int AS count FROM "StudySession" WHERE "id" = $1',
          [session.id]
        )
      ).rows[0]?.count
    ).toBe(0)
  })

  it('GUEST submission facts를 principal root에서 모두 cascade 삭제한다', async () => {
    const question = await loadQuestion()
    const guestId = randomUUID()
    const sessionId = randomUUID()
    const itemId = randomUUID()
    const answerId = randomUUID()
    const resultId = randomUUID()
    const recordId = randomUUID()
    const startedAt = addMilliseconds(new Date(), -HOUR_MS)
    const occurredAt = new Date()
    const requestHash = createHash()
    createdGuestIds.add(guestId)

    await client.query(
      `INSERT INTO "GuestPrincipal" (
        "id", "tokenDigest", "expiresAt", "createdAt", "lastSeenAt"
      ) VALUES ($1, $2, $3, $4, $4)`,
      [guestId, createHash(), addMilliseconds(startedAt, DAY_MS), startedAt]
    )
    await transaction(async () => {
      await client.query(
        `INSERT INTO "StudySession" (
          "id", "guestPrincipalId", "level", "subject", "mode", "status",
          "requestedCount", "actualCount", "usedFallback", "startedAt",
          "expiresAt", "createdAt", "updatedAt"
        ) VALUES (
          $1, $2, 'N5', 'VOCABULARY', 'RANDOM', 'IN_PROGRESS',
          1, 1, false, $3, $4, $3, $3
        )`,
        [sessionId, guestId, startedAt, addMilliseconds(startedAt, DAY_MS)]
      )
      await client.query(
        `INSERT INTO "StudySessionQuestion" (
          "id", "studySessionId", "questionId", "questionVersionId",
          "ordinal", "createdAt"
        ) VALUES ($1, $2, $3, $4, 1, $5)`,
        [
          itemId,
          sessionId,
          question.questionId,
          question.questionVersionId,
          startedAt
        ]
      )
    })

    await transaction(async () => {
      await client.query(
        `INSERT INTO "IdempotencyRecord" (
          "id", "principalType", "guestPrincipalId", "operation",
          "idempotencyKey", "studySessionId", "requestHash", "state",
          "createdAt"
        ) VALUES (
          $1, 'GUEST', $2, 'STUDY_SUBMIT', $3, $4, $5,
          'PROCESSING', $6
        )`,
        [
          recordId,
          guestId,
          randomUUID(),
          sessionId,
          requestHash,
          addMilliseconds(occurredAt, -1_000)
        ]
      )
      await client.query(
        `INSERT INTO "StudyAnswer" (
          "id", "studySessionQuestionId", "questionVersionId",
          "selectedOptionId", "isCorrect", "elapsedSec", "gradingVersion",
          "answeredAt", "gradedAt"
        ) VALUES ($1, $2, $3, $4, true, 1, $5, $6, $6)`,
        [
          answerId,
          itemId,
          question.questionVersionId,
          question.correctOptionId,
          GRADING_VERSION,
          occurredAt
        ]
      )
      const durationSec = Math.floor(
        (occurredAt.getTime() - startedAt.getTime()) / 1_000
      )
      await client.query(
        `INSERT INTO "StudyResult" (
          "id", "studySessionId", "totalCount", "correctCount",
          "incorrectCount", "correctRateBasisPoints", "durationSec",
          "gradingVersion", "createdAt"
        ) VALUES ($1, $2, 1, 1, 0, 10000, $3, $4, $5)`,
        [resultId, sessionId, durationSec, GRADING_VERSION, occurredAt]
      )
      await client.query(
        `UPDATE "GuestPrincipal"
         SET "expiresAt" = $2, "lastSeenAt" = $1
         WHERE "id" = $3`,
        [occurredAt, addMilliseconds(occurredAt, 7 * DAY_MS), guestId]
      )
      await client.query(
        `UPDATE "StudySession"
         SET "status" = 'SUBMITTED', "submittedAt" = $2,
             "durationSec" = $3, "submissionHash" = $4, "updatedAt" = $2
         WHERE "id" = $1`,
        [sessionId, occurredAt, durationSec, requestHash]
      )
      await client.query(
        `UPDATE "IdempotencyRecord"
         SET "state" = 'SUCCEEDED', "responseStatus" = 201,
             "responseBody" = $2::jsonb, "completedAt" = $3,
             "expiresAt" = $4
         WHERE "id" = $1`,
        [
          recordId,
          JSON.stringify({ sessionId }),
          occurredAt,
          addMilliseconds(occurredAt, DAY_MS)
        ]
      )
    })

    await client.query('DELETE FROM "GuestPrincipal" WHERE "id" = $1', [
      guestId
    ])
    const result = await client.query<{
      answers: number
      idempotencyRecords: number
      results: number
      sessions: number
    }>(
      `SELECT
        (SELECT COUNT(*)::int FROM "StudySession"
          WHERE "id" = $1) AS sessions,
        (SELECT COUNT(*)::int FROM "StudyAnswer"
          WHERE "id" = $2) AS answers,
        (SELECT COUNT(*)::int FROM "StudyResult"
          WHERE "id" = $3) AS results,
        (SELECT COUNT(*)::int FROM "IdempotencyRecord"
          WHERE "id" = $4) AS "idempotencyRecords"`,
      [sessionId, answerId, resultId, recordId]
    )
    expect(result.rows[0]).toEqual({
      sessions: 0,
      answers: 0,
      results: 0,
      idempotencyRecords: 0
    })
  })

  it('latest previous snapshot, strict time, monotonic updatedAt과 rewind 방지를 강제한다', async () => {
    const userId = await createUser('event-chain')
    const question = await loadQuestion()
    const firstAt = addMilliseconds(new Date(), -2 * HOUR_MS)
    const first = await createInitialWrongNote(userId, question, firstAt)
    const secondAt = addMilliseconds(firstAt, HOUR_MS)

    const missingEventSession = await createSession(
      userId,
      question,
      addMilliseconds(firstAt, -30 * 60 * 1_000)
    )
    await expect(
      transaction(async () => {
        const recordId = randomUUID()
        const requestHash = createHash()
        const occurredAt = addMilliseconds(firstAt, 30 * 60 * 1_000)
        await insertProcessing(
          recordId,
          missingEventSession.id,
          userId,
          requestHash,
          addMilliseconds(occurredAt, -1_000)
        )
        await client.query(
          `INSERT INTO "StudyAnswer" (
            "id", "studySessionQuestionId", "questionVersionId",
            "selectedOptionId", "isCorrect", "elapsedSec", "gradingVersion",
            "answeredAt", "gradedAt"
          ) VALUES ($1, $2, $3, $4, true, 1, $5, $6, $6)`,
          [
            randomUUID(),
            missingEventSession.itemId,
            question.questionVersionId,
            question.correctOptionId,
            GRADING_VERSION,
            occurredAt
          ]
        )
        await finalizeSession(
          recordId,
          missingEventSession,
          requestHash,
          occurredAt,
          1
        )
      })
    ).rejects.toMatchObject({
      code: '23514',
      message: 'Submitted StudySession facts are incomplete or inconsistent.'
    })

    await transitionToReviewing(userId, question, first.noteId, secondAt)
    const thirdSession = await createSession(
      userId,
      question,
      addMilliseconds(secondAt, -30 * 60 * 1_000)
    )

    await expect(
      transaction(async () => {
        const answerId = randomUUID()
        await client.query(
          `INSERT INTO "StudyAnswer" (
            "id", "studySessionQuestionId", "questionVersionId",
            "selectedOptionId", "isCorrect", "elapsedSec", "gradingVersion",
            "answeredAt", "gradedAt"
          ) VALUES ($1, $2, $3, $4, true, 1, $5, $6, $6)`,
          [
            answerId,
            thirdSession.itemId,
            question.questionVersionId,
            question.correctOptionId,
            GRADING_VERSION,
            addMilliseconds(secondAt, HOUR_MS)
          ]
        )
        await client.query(
          `INSERT INTO "ReviewEvent" (
            "id", "wrongNoteId", "userId", "questionId",
            "questionVersionId", "source", "studySessionId", "studyAnswerId",
            "selectedOptionId", "isCorrect", "previousStatus", "nextStatus",
            "previousCorrectStreak", "nextCorrectStreak",
            "previousWrongCount", "wrongCountAfter", "algorithmVersion",
            "occurredAt"
          ) VALUES (
            $1, $2, $3, $4, $5, 'STUDY_SUBMIT', $6, $7, $8, true,
            'NEW', 'REVIEWING', 0, 1, 1, 1, 1, $9
          )`,
          [
            randomUUID(),
            first.noteId,
            userId,
            question.questionId,
            question.questionVersionId,
            thirdSession.id,
            answerId,
            question.correctOptionId,
            addMilliseconds(secondAt, HOUR_MS)
          ]
        )
      })
    ).rejects.toMatchObject({
      code: '23514',
      message:
        'ReviewEvent must extend the latest event snapshot monotonically.'
    })

    await expect(
      transaction(async () => {
        await client.query(
          `UPDATE "WrongNote"
           SET "status" = 'NEW', "correctStreak" = 0,
               "lastReviewedAt" = NULL, "updatedAt" = $2
           WHERE "id" = $1`,
          [first.noteId, secondAt]
        )
        await client.query(
          `UPDATE "ReviewSchedule"
           SET "intervalDays" = 1, "nextReviewAt" = $2, "updatedAt" = $3
           WHERE "wrongNoteId" = $1`,
          [first.noteId, addMilliseconds(firstAt, DAY_MS), secondAt]
        )
      })
    ).rejects.toMatchObject({ code: '23514' })

    await expect(
      client.query(
        `UPDATE "WrongNote"
         SET "updatedAt" = $2
         WHERE "id" = $1`,
        [first.noteId, addMilliseconds(firstAt, -1)]
      )
    ).rejects.toMatchObject({ code: '23514' })

    await expect(
      client.query(
        `UPDATE "WrongNote"
         SET "lastWrongAt" = $2
         WHERE "id" = $1`,
        [first.noteId, addMilliseconds(firstAt, 1)]
      )
    ).rejects.toMatchObject({
      code: '23514',
      message: 'WrongNote must match its latest incorrect ReviewEvent.'
    })

    const state = await client.query<{
      eventCount: number
      intervalDays: number
      status: string
    }>(
      `SELECT
        note."status"::text AS status,
        schedule."intervalDays" AS "intervalDays",
        (SELECT COUNT(*)::int FROM "ReviewEvent"
          WHERE "wrongNoteId" = note."id") AS "eventCount"
       FROM "WrongNote" AS note
       JOIN "ReviewSchedule" AS schedule
         ON schedule."wrongNoteId" = note."id"
       WHERE note."id" = $1`,
      [first.noteId]
    )
    expect(state.rows[0]).toEqual({
      status: 'REVIEWING',
      intervalDays: 3,
      eventCount: 2
    })

    await client.query('DELETE FROM "User" WHERE "id" = $1', [userId])
    const cascaded = await client.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count
       FROM "ReviewEvent"
       WHERE "wrongNoteId" = $1`,
      [first.noteId]
    )
    expect(cascaded.rows[0]?.count).toBe(0)
  })
})
