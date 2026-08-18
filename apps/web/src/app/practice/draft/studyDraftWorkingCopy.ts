import { z } from 'zod'
import { studyDraftSnapshotSchema } from '@nihongo/contracts/study/study-draft'
import { saveStudyDraftAnswersRequestBodySchema } from '@api/study/saveStudyDraftAnswers/schema'
import {
  canonicalizeStudyDraftSave,
  STUDY_DRAFT_SAVE_CANONICAL_PREFIX
} from '@app/practice/draft/studyDraftCanonicalizer'
import {
  applyStudyDraftDiff,
  createEmptyStudyDraftDiff,
  isStudyDraftDiffEmpty,
  mergeStudyDraftSnapshots,
  type StudyDraftLocalDiff
} from '@app/practice/draft/studyDraftMerge'

export const STUDY_DRAFT_WORKING_COPY_VERSION = 1 as const

const answerDiffSchema = z
  .object({
    elapsedSec: z.number().int().min(0).max(86_400).optional(),
    selectedOptionId: z.uuid().nullable().optional()
  })
  .strict()
  .refine(
    (value) =>
      value.elapsedSec !== undefined || value.selectedOptionId !== undefined,
    { message: 'answer diff에는 변경 필드가 하나 이상 필요합니다.' }
  )

const persistedStudyDraftConflictSchema = z.union([
  z
    .object({
      base: z.union([z.uuid().nullable(), z.number().int().min(0).max(86_400)]),
      field: z.enum(['selectedOptionId', 'elapsedSec']),
      local: z.union([
        z.uuid().nullable(),
        z.number().int().min(0).max(86_400)
      ]),
      remote: z.union([
        z.uuid().nullable(),
        z.number().int().min(0).max(86_400)
      ]),
      studySessionQuestionId: z.uuid()
    })
    .strict(),
  z
    .object({
      base: z.number().int().min(1).max(20),
      field: z.literal('currentOrdinal'),
      local: z.number().int().min(1).max(20),
      remote: z.number().int().min(1).max(20)
    })
    .strict()
])

const persistedStudyDraftConflictStateSchema = z
  .object({
    base: studyDraftSnapshotSchema,
    conflicts: z.array(persistedStudyDraftConflictSchema).min(1),
    local: studyDraftSnapshotSchema,
    localPreferred: studyDraftSnapshotSchema,
    remote: studyDraftSnapshotSchema
  })
  .strict()

export const studyDraftLocalDiffSchema = z
  .object({
    answers: z.record(z.uuid(), answerDiffSchema),
    currentOrdinal: z.number().int().min(1).max(20).optional()
  })
  .strict()

export const frozenStudyDraftAttemptSchema = z
  .object({
    canonicalHashInput: z
      .string()
      .startsWith(STUDY_DRAFT_SAVE_CANONICAL_PREFIX),
    exactParsedBody: saveStudyDraftAnswersRequestBodySchema,
    idempotencyKey: z.uuid()
  })
  .strict()

export const studyDraftWorkingCopySchema = z
  .object({
    confirmedBase: studyDraftSnapshotSchema,
    confirmedBaseDigest: z.string().min(1),
    frozenAttempt: frozenStudyDraftAttemptSchema.nullable(),
    localDiff: studyDraftLocalDiffSchema,
    pendingConflict: persistedStudyDraftConflictStateSchema
      .nullable()
      .default(null),
    postFlightLocalDiff: studyDraftLocalDiffSchema,
    principalScope: z.string().min(1),
    schemaVersion: z.literal(STUDY_DRAFT_WORKING_COPY_VERSION),
    sessionId: z.uuid()
  })
  .strict()
  .superRefine((record, context) => {
    const baseQuestionIds = new Set(
      record.confirmedBase.answers.map(
        ({ studySessionQuestionId }) => studySessionQuestionId
      )
    )

    for (const [field, diff] of [
      ['localDiff', record.localDiff],
      ['postFlightLocalDiff', record.postFlightLocalDiff]
    ] as const) {
      if (
        diff.currentOrdinal !== undefined &&
        diff.currentOrdinal > record.confirmedBase.answers.length
      ) {
        context.addIssue({
          code: 'custom',
          path: [field, 'currentOrdinal'],
          message: 'working copy의 현재 문항은 draft 범위 안이어야 합니다.'
        })
      }

      for (const questionId of Object.keys(diff.answers)) {
        if (!baseQuestionIds.has(questionId)) {
          context.addIssue({
            code: 'custom',
            path: [field, 'answers', questionId],
            message:
              'working copy 변경은 현재 세션 문제에만 적용할 수 있습니다.'
          })
        }
      }
    }

    if (
      record.frozenAttempt === null &&
      !isStudyDraftDiffEmpty(record.postFlightLocalDiff)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['postFlightLocalDiff'],
        message: 'post-flight 변경은 frozen attempt가 있을 때만 허용됩니다.'
      })
    }
    if (
      record.frozenAttempt !== null &&
      !isStudyDraftDiffEmpty(record.localDiff)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['localDiff'],
        message: '전송 중 변경은 local diff가 아니라 post-flight에 저장합니다.'
      })
    }

    if (record.pendingConflict) {
      const expectedQuestionIds = JSON.stringify(
        record.confirmedBase.answers.map(
          ({ studySessionQuestionId }) => studySessionQuestionId
        )
      )
      const conflictQuestionIdsMatch = [
        record.pendingConflict.base,
        record.pendingConflict.local,
        record.pendingConflict.localPreferred,
        record.pendingConflict.remote
      ].every(
        (snapshot) =>
          JSON.stringify(
            snapshot.answers.map(
              ({ studySessionQuestionId }) => studySessionQuestionId
            )
          ) === expectedQuestionIds
      )
      const expectedLocal = applyStudyDraftDiff(
        record.confirmedBase,
        record.localDiff
      )
      const recomputed = mergeStudyDraftSnapshots(
        record.pendingConflict.base,
        record.pendingConflict.local,
        record.pendingConflict.remote
      )
      const canonicalizeConflicts = (
        conflicts: typeof recomputed.conflicts
      ): string =>
        JSON.stringify(
          conflicts.map((conflict) => ({
            field: conflict.field,
            ...('studySessionQuestionId' in conflict
              ? {
                  studySessionQuestionId: conflict.studySessionQuestionId
                }
              : {}),
            base: conflict.base,
            local: conflict.local,
            remote: conflict.remote
          }))
        )
      if (
        record.frozenAttempt ||
        !conflictQuestionIdsMatch ||
        record.pendingConflict.remote.studySessionId !== record.sessionId ||
        record.pendingConflict.localPreferred.studySessionId !==
          record.sessionId ||
        record.pendingConflict.local.studySessionId !== record.sessionId ||
        record.pendingConflict.base.studySessionId !== record.sessionId ||
        canonicalizeBase(record.pendingConflict.remote) !==
          canonicalizeBase(record.confirmedBase) ||
        canonicalizeBase(record.pendingConflict.localPreferred) !==
          canonicalizeBase(expectedLocal) ||
        canonicalizeBase(recomputed.localPreferred) !==
          canonicalizeBase(record.pendingConflict.localPreferred) ||
        canonicalizeConflicts(recomputed.conflicts) !==
          canonicalizeConflicts(record.pendingConflict.conflicts)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['pendingConflict'],
          message: '충돌 기록은 현재 canonical base와 같은 세션이어야 합니다.'
        })
      }
    }
  })

export interface FrozenStudyDraftAttempt {
  canonicalHashInput: string
  exactParsedBody: z.output<typeof saveStudyDraftAnswersRequestBodySchema>
  idempotencyKey: string
}

export interface StudyDraftWorkingCopy {
  confirmedBase: z.output<typeof studyDraftSnapshotSchema>
  confirmedBaseDigest: string
  frozenAttempt: FrozenStudyDraftAttempt | null
  localDiff: StudyDraftLocalDiff
  pendingConflict: z.output<
    typeof persistedStudyDraftConflictStateSchema
  > | null
  postFlightLocalDiff: StudyDraftLocalDiff
  principalScope: string
  schemaVersion: typeof STUDY_DRAFT_WORKING_COPY_VERSION
  sessionId: string
}

const canonicalizeBase = (
  snapshot: z.output<typeof studyDraftSnapshotSchema>
): string =>
  JSON.stringify({
    studySessionId: snapshot.studySessionId,
    revision: snapshot.revision,
    currentOrdinal: snapshot.currentOrdinal,
    savedAt: snapshot.savedAt,
    answers: snapshot.answers.map(
      ({ studySessionQuestionId, selectedOptionId, elapsedSec }) => ({
        studySessionQuestionId,
        selectedOptionId,
        elapsedSec
      })
    )
  })

export const createStudyDraftBaseDigest = (
  snapshot: z.output<typeof studyDraftSnapshotSchema>
): string => canonicalizeBase(snapshot)

export const createStudyDraftWorkingCopy = ({
  confirmedBase,
  principalScope,
  sessionId
}: {
  confirmedBase: z.output<typeof studyDraftSnapshotSchema>
  principalScope: string
  sessionId: string
}): StudyDraftWorkingCopy => ({
  confirmedBase,
  confirmedBaseDigest: createStudyDraftBaseDigest(confirmedBase),
  frozenAttempt: null,
  localDiff: createEmptyStudyDraftDiff(),
  pendingConflict: null,
  postFlightLocalDiff: createEmptyStudyDraftDiff(),
  principalScope,
  schemaVersion: STUDY_DRAFT_WORKING_COPY_VERSION,
  sessionId
})

export const createFrozenStudyDraftAttempt = ({
  body,
  idempotencyKey,
  sessionId
}: {
  body: z.output<typeof saveStudyDraftAnswersRequestBodySchema>
  idempotencyKey: string
  sessionId: string
}): FrozenStudyDraftAttempt => ({
  canonicalHashInput: canonicalizeStudyDraftSave(
    sessionId,
    body.answers.map(({ studySessionQuestionId }) => studySessionQuestionId),
    body
  ),
  exactParsedBody: body,
  idempotencyKey
})

export const parseStudyDraftWorkingCopy = (
  value: unknown,
  expected: { principalScope: string; sessionId: string }
): StudyDraftWorkingCopy | null => {
  const parsed = studyDraftWorkingCopySchema.safeParse(value)
  if (!parsed.success) {
    return null
  }

  const record = parsed.data
  if (
    record.principalScope !== expected.principalScope ||
    record.sessionId !== expected.sessionId ||
    record.confirmedBase.studySessionId !== expected.sessionId ||
    record.confirmedBaseDigest !==
      createStudyDraftBaseDigest(record.confirmedBase)
  ) {
    return null
  }

  if (record.frozenAttempt) {
    const expectedIds = record.confirmedBase.answers.map(
      ({ studySessionQuestionId }) => studySessionQuestionId
    )
    const submittedIds = record.frozenAttempt.exactParsedBody.answers.map(
      ({ studySessionQuestionId }) => studySessionQuestionId
    )
    const canonical = canonicalizeStudyDraftSave(
      record.sessionId,
      expectedIds,
      record.frozenAttempt.exactParsedBody
    )
    if (
      canonical !== record.frozenAttempt.canonicalHashInput ||
      record.frozenAttempt.exactParsedBody.expectedRevision !==
        record.confirmedBase.revision ||
      JSON.stringify(submittedIds) !== JSON.stringify(expectedIds)
    ) {
      return null
    }
  }

  return record
}
