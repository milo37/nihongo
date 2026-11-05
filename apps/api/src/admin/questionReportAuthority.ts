import type { Prisma } from '../generated/prisma/client.js'

/**
 * QuestionReport creation in the API transaction (#504 P7 PR4c-2).
 *
 * This keeps phase7_create_question_report (with its _pre_reauthentication
 * body) step for step: the same Session checks, the same lock order (User,
 * Session, then Question, QuestionVersion, the reporter's study pins and wrong
 * notes FOR SHARE), the same entitlement rule, the same re-check before commit
 * and the same SQLSTATE and message on failure. The QuestionReport insert
 * trigger fills the server-owned columns (digest, state, row version, reporter
 * snapshot, times) and validates the row.
 */

type Transaction = Prisma.TransactionClient

const raise = async (
  transaction: Transaction,
  sqlState: '23503' | '42501',
  message: string
): Promise<never> => {
  await transaction.$executeRawUnsafe(
    `DO $raise$ BEGIN RAISE EXCEPTION USING ERRCODE = '${sqlState}', MESSAGE = '${message}'; END $raise$`
  )
  throw new Error('PostgreSQL did not raise the QuestionReport failure.')
}

const STALE = 'QuestionReport reporter authority is stale.'

export const createQuestionReportInTransaction = async (
  transaction: Transaction,
  input: {
    readonly rawSessionToken: string
    readonly reportId: string
    readonly questionId: string
    readonly questionVersionId: string
    readonly reason: string
    readonly description: string
  }
): Promise<Array<{ id: string; rowVersion: number }>> => {
  // active_authorization_session
  const active = await transaction.$queryRawUnsafe<unknown[]>(
    `SELECT 1 FROM "Session"
     WHERE "token" = $1 AND "authorizationState" = 'ACTIVE'`,
    input.rawSessionToken
  )
  if (active.length === 0) await raise(transaction, '42501', STALE)
  await transaction.$executeRawUnsafe(
    `SELECT "require_database_capability"(NULL)`
  )
  const sessions = await transaction.$queryRawUnsafe<
    Array<{ sessionId: string; userId: string }>
  >(
    `SELECT "userId", "id" AS "sessionId" FROM "Session" WHERE "token" = $1`,
    input.rawSessionToken
  )
  const target = sessions[0]
  if (!target) return raise(transaction, '42501', STALE)
  await transaction.$queryRawUnsafe(
    `SELECT 1 FROM "User" WHERE "id" = $1::uuid FOR UPDATE`,
    target.userId
  )
  const lockedSession = await transaction.$queryRawUnsafe<unknown[]>(
    `SELECT 1 FROM "Session"
     WHERE "id" = $1::uuid AND "userId" = $2::uuid FOR UPDATE`,
    target.sessionId,
    target.userId
  )
  if (lockedSession.length !== 1)
    await raise(
      transaction,
      '42501',
      'QuestionReport reporter Session is stale.'
    )
  const reporters = await transaction.$queryRawUnsafe<
    Array<{ generation: number; id: string; role: string }>
  >(
    `SELECT target_user."id", target_user."role"::text AS role,
       target_user."authorityGeneration" AS generation
     FROM "User" AS target_user
     JOIN "Session" AS target_session
       ON target_session."userId" = target_user."id"
     WHERE target_session."token" = $1
       AND target_session."id" = $2::uuid
       AND target_user."accountStatus" = 'ACTIVE'
       AND target_session."issuerProtocolVersion" = 'PHASE7_V1'
       AND target_session."authorityGeneration" = target_user."authorityGeneration"
       AND target_session."expiresAt" > clock_timestamp()
       AND target_session."createdAt" + INTERVAL '30 days' > clock_timestamp()`,
    input.rawSessionToken,
    target.sessionId
  )
  const reporter = reporters[0]
  if (!reporter) return raise(transaction, '42501', STALE)

  const question = await transaction.$queryRawUnsafe<unknown[]>(
    `SELECT 1 FROM "Question" WHERE "id" = $1::uuid FOR SHARE`,
    input.questionId
  )
  if (question.length !== 1)
    await raise(
      transaction,
      '23503',
      'QuestionReport target Question is missing.'
    )
  const version = await transaction.$queryRawUnsafe<unknown[]>(
    `SELECT 1 FROM "QuestionVersion"
     WHERE "id" = $1::uuid AND "questionId" = $2::uuid FOR SHARE`,
    input.questionVersionId,
    input.questionId
  )
  if (version.length !== 1)
    await raise(
      transaction,
      '23503',
      'QuestionReport target version is missing.'
    )
  await transaction.$queryRawUnsafe(
    `SELECT 1
     FROM "StudySessionQuestion" AS session_question
     JOIN "StudySession" AS study_session
       ON study_session."id" = session_question."studySessionId"
     WHERE study_session."userId" = $1::uuid
       AND session_question."questionId" = $2::uuid
       AND session_question."questionVersionId" = $3::uuid
     ORDER BY session_question."id"
     FOR SHARE OF session_question, study_session`,
    reporter.id,
    input.questionId,
    input.questionVersionId
  )
  await transaction.$queryRawUnsafe(
    `SELECT 1 FROM "WrongNote"
     WHERE "userId" = $1::uuid AND "questionId" = $2::uuid
     ORDER BY "id" FOR SHARE`,
    reporter.id,
    input.questionId
  )
  const entitled = await transaction.$queryRawUnsafe<
    Array<{ entitled: boolean }>
  >(
    `SELECT EXISTS (
         SELECT 1 FROM "Question"
         WHERE "id" = $2::uuid AND "lifecycleStatus" = 'ACTIVE'
           AND "currentPublishedVersionId" = $3::uuid
       ) OR EXISTS (
         SELECT 1
         FROM "StudySessionQuestion" AS session_question
         JOIN "StudySession" AS study_session
           ON study_session."id" = session_question."studySessionId"
         WHERE study_session."userId" = $1::uuid
           AND session_question."questionId" = $2::uuid
           AND session_question."questionVersionId" = $3::uuid
       ) OR EXISTS (
         SELECT 1 FROM "WrongNote" AS note
         WHERE note."userId" = $1::uuid AND note."questionId" = $2::uuid
           AND $3::uuid IN (
             note."lastWrongQuestionVersionId",
             note."currentReviewQuestionVersionId"
           )
       ) AS entitled`,
    reporter.id,
    input.questionId,
    input.questionVersionId
  )
  if (entitled[0]?.entitled !== true)
    await raise(transaction, '23503', 'QuestionReport target is not entitled.')

  // The insert trigger sets the digest, state, row version, reporter
  // snapshot and times.
  const created = await transaction.$queryRawUnsafe<
    Array<{ id: string; rowVersion: number }>
  >(
    `INSERT INTO "QuestionReport" (
       "id", "questionId", "questionVersionId", "reason", "description",
       "reporterUserId"
     ) VALUES (
       $1::uuid, $2::uuid, $3::uuid, $4::"QuestionReportReason", $5, $6::uuid
     )
     RETURNING "id", "rowVersion"`,
    input.reportId,
    input.questionId,
    input.questionVersionId,
    input.reason,
    input.description,
    reporter.id
  )
  const confirmed = await transaction.$queryRawUnsafe<unknown[]>(
    `SELECT 1
     FROM "User" AS target_user
     JOIN "Session" AS target_session
       ON target_session."userId" = target_user."id"
      AND target_session."id" = $2::uuid
     WHERE target_user."id" = $1::uuid
       AND target_user."role" = $3::"UserRole"
       AND target_user."accountStatus" = 'ACTIVE'
       AND target_user."authorityGeneration" = $4::integer
       AND target_session."token" = $5
       AND target_session."issuerProtocolVersion" = 'PHASE7_V1'
       AND target_session."authorityGeneration" = $4::integer
       AND target_session."expiresAt" > clock_timestamp()
       AND target_session."createdAt" + INTERVAL '30 days' > clock_timestamp()`,
    reporter.id,
    target.sessionId,
    reporter.role,
    reporter.generation,
    input.rawSessionToken
  )
  if (confirmed.length !== 1)
    await raise(
      transaction,
      '42501',
      'QuestionReport reporter authority expired before commit.'
    )
  return created
}
