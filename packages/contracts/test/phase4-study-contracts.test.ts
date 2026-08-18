import { describe, expect, it } from 'vitest'
import {
  cancelStudySessionBodySchema,
  cancelStudySessionErrorCodeSchema,
  cancelStudySessionHeadersSchema,
  cancelStudySessionParamsSchema
} from '../src/study/cancel-study-session.js'
import {
  createResultRetrySessionBodySchema,
  createResultRetrySessionErrorCodeSchema,
  createResultRetrySessionHeadersSchema,
  createResultRetrySessionParamsSchema,
  createResultRetrySessionResponseSchema
} from '../src/study/create-result-retry-session.js'
import {
  createStudySessionHeadersSchema,
  createStudySessionResponseSchema,
  createStudySessionV2HeadersSchema,
  createStudySessionV2ResponseSchema
} from '../src/study/create-study-session.js'
import {
  getStudyDraftAnswersErrorCodeSchema,
  getStudyDraftAnswersHeadersSchema,
  getStudyDraftAnswersParamsSchema,
  getStudyDraftAnswersResponseSchema
} from '../src/study/get-study-draft-answers.js'
import {
  getStudySessionErrorCodeSchema,
  getStudySessionHeadersSchema,
  getStudySessionV2HeadersSchema,
  getStudySessionV2ResponseSchema
} from '../src/study/get-study-session.js'
import {
  listResumableStudySessionsErrorCodeSchema,
  listResumableStudySessionsHeadersSchema,
  listResumableStudySessionsQuerySchema,
  listResumableStudySessionsResponseSchema,
  resumableStudySessionSummarySchema
} from '../src/study/list-resumable-study-sessions.js'
import {
  practiceContractResponseHeadersSchema,
  practiceContractV2HeadersSchema
} from '../src/study/practice-contract.js'
import {
  saveStudyDraftAnswersBodySchema,
  saveStudyDraftAnswersErrorCodeSchema,
  saveStudyDraftAnswersHeadersSchema,
  saveStudyDraftAnswersParamsSchema,
  saveStudyDraftAnswersResponseSchema
} from '../src/study/save-study-draft-answers.js'
import { studyDraftSnapshotSchema } from '../src/study/study-draft.js'

const id = (index: number): string =>
  `018f6b7a-1f4b-7d5e-8a91-${index.toString(16).padStart(12, '0')}`

const question = {
  id: id(10),
  questionVersionId: id(11),
  level: 'N5',
  subject: 'VOCABULARY',
  questionType: 'KANJI_READING',
  passage: null,
  questionText: '「川」의 읽는 법은 어느 것입니까.',
  options: ['かわ', 'やま', 'うみ', 'そら'].map((text, index) => ({
    id: id(20 + index),
    label: String(index + 1),
    text
  })),
  difficulty: 'EASY',
  tags: [{ id: id(30), label: '한자 읽기' }]
}

const baseSession = {
  id: id(1),
  level: 'N5',
  subject: 'VOCABULARY',
  mode: 'RANDOM',
  status: 'IN_PROGRESS',
  requestedCount: 1,
  actualCount: 1,
  usedFallback: false,
  fallbackReason: null,
  startedAt: '2026-08-17T01:00:00.000Z',
  expiresAt: '2026-08-18T01:00:00.000Z',
  submittedAt: null,
  durationSec: null
}

const basePayload = {
  session: baseSession,
  questions: [{ sessionQuestionId: id(2), ordinal: 1, question }]
}

const draftAnswers = [
  {
    studySessionQuestionId: id(2),
    selectedOptionId: null,
    elapsedSec: 12
  }
]

const failureCodes = {
  resumable: [
    'AUTHENTICATION_REQUIRED',
    'AUTH_SESSION_EXPIRED',
    'GUEST_SESSION_EXPIRED',
    'INVALID_REQUEST',
    'VALIDATION_ERROR',
    'RATE_LIMITED',
    'INTERNAL_SERVER_ERROR',
    'SERVICE_UNAVAILABLE'
  ],
  draftGet: [
    'AUTHENTICATION_REQUIRED',
    'AUTH_SESSION_EXPIRED',
    'GUEST_SESSION_EXPIRED',
    'INVALID_REQUEST',
    'INVALID_ID',
    'RESOURCE_NOT_FOUND',
    'STUDY_SESSION_NOT_EDITABLE',
    'PRACTICE_CONTRACT_VERSION_MISMATCH',
    'RATE_LIMITED',
    'INTERNAL_SERVER_ERROR',
    'SERVICE_UNAVAILABLE'
  ],
  draftSave: [
    'AUTHENTICATION_REQUIRED',
    'AUTH_SESSION_EXPIRED',
    'GUEST_SESSION_EXPIRED',
    'INVALID_JSON',
    'INVALID_REQUEST',
    'INVALID_CSRF',
    'UNTRUSTED_ORIGIN',
    'INVALID_ID',
    'RESOURCE_NOT_FOUND',
    'IDEMPOTENCY_KEY_REQUIRED',
    'IDEMPOTENCY_KEY_REUSED',
    'DRAFT_VERSION_CONFLICT',
    'STUDY_SESSION_NOT_EDITABLE',
    'PRACTICE_CONTRACT_VERSION_MISMATCH',
    'VALIDATION_ERROR',
    'ANSWER_NOT_IN_SESSION',
    'OPTION_NOT_IN_VERSION',
    'INVALID_DURATION',
    'RATE_LIMITED',
    'INTERNAL_SERVER_ERROR',
    'SERVICE_UNAVAILABLE'
  ],
  cancel: [
    'AUTHENTICATION_REQUIRED',
    'AUTH_SESSION_EXPIRED',
    'GUEST_SESSION_EXPIRED',
    'INVALID_JSON',
    'INVALID_REQUEST',
    'INVALID_CSRF',
    'UNTRUSTED_ORIGIN',
    'INVALID_ID',
    'RESOURCE_NOT_FOUND',
    'STUDY_SESSION_NOT_EDITABLE',
    'RATE_LIMITED',
    'INTERNAL_SERVER_ERROR',
    'SERVICE_UNAVAILABLE'
  ],
  retry: [
    'AUTHENTICATION_REQUIRED',
    'AUTH_SESSION_EXPIRED',
    'GUEST_SESSION_EXPIRED',
    'INVALID_JSON',
    'INVALID_REQUEST',
    'INVALID_CSRF',
    'UNTRUSTED_ORIGIN',
    'INVALID_ID',
    'RESOURCE_NOT_FOUND',
    'IDEMPOTENCY_KEY_REQUIRED',
    'IDEMPOTENCY_KEY_REUSED',
    'STUDY_RESULT_NOT_READY',
    'NO_ELIGIBLE_QUESTIONS',
    'RATE_LIMITED',
    'INTERNAL_SERVER_ERROR',
    'SERVICE_UNAVAILABLE'
  ]
} as const

describe('Phase 4 study contracts', () => {
  it('practice header negotiation과 response header를 strict lower-case로 닫는다', () => {
    expect(createStudySessionHeadersSchema.parse({})).toEqual({})
    expect(getStudySessionHeadersSchema.parse({})).toEqual({})
    expect(
      createStudySessionHeadersSchema.safeParse({
        'x-nihongo-practice-contract': '2'
      }).success
    ).toBe(false)
    expect(
      getStudySessionHeadersSchema.safeParse({
        'x-nihongo-practice-contract': '2'
      }).success
    ).toBe(false)
    for (const schema of [
      createStudySessionV2HeadersSchema,
      getStudySessionV2HeadersSchema
    ]) {
      expect(schema.parse({ 'x-nihongo-practice-contract': '2' })).toEqual({
        'x-nihongo-practice-contract': '2'
      })
    }
    expect(practiceContractV2HeadersSchema.safeParse({}).success).toBe(false)

    for (const invalid of [
      { 'X-Nihongo-Practice-Contract': '2' },
      { 'x-nihongo-practice-contract': '1' },
      { 'x-nihongo-practice-contract': '3' }
    ]) {
      expect(practiceContractV2HeadersSchema.safeParse(invalid).success).toBe(
        false
      )
    }

    expect(
      practiceContractResponseHeadersSchema.parse({
        'x-nihongo-practice-contract': '1'
      })
    ).toEqual({ 'x-nihongo-practice-contract': '1' })
  })

  it('v1 payload를 그대로 보존하고 v2 payload를 별도 version field로 닫는다', () => {
    expect(createStudySessionResponseSchema.parse(basePayload)).toEqual(
      basePayload
    )
    expect(
      createStudySessionResponseSchema.safeParse({
        ...basePayload,
        session: { ...baseSession, practiceContractVersion: 1 }
      }).success
    ).toBe(false)

    for (const version of [1, 2] as const) {
      expect(
        getStudySessionV2ResponseSchema.parse({
          ...basePayload,
          session: { ...baseSession, practiceContractVersion: version }
        }).session.practiceContractVersion
      ).toBe(version)
    }

    expect(
      createStudySessionV2ResponseSchema.parse({
        ...basePayload,
        session: { ...baseSession, practiceContractVersion: 2 }
      }).session.practiceContractVersion
    ).toBe(2)
    expect(
      createStudySessionV2ResponseSchema.safeParse({
        ...basePayload,
        session: { ...baseSession, practiceContractVersion: 1 }
      }).success
    ).toBe(false)

    expect(
      createStudySessionV2ResponseSchema.safeParse({
        ...basePayload,
        session: {
          ...baseSession,
          mode: 'WEAKNESS',
          usedFallback: true,
          fallbackReason: 'INSUFFICIENT_MODE_CANDIDATES',
          practiceContractVersion: 2
        }
      }).success
    ).toBe(false)
  })

  it('draft snapshot과 save body의 revision·full answer·strict 경계를 고정한다', () => {
    const initial = {
      studySessionId: id(1),
      revision: 0,
      currentOrdinal: 1,
      savedAt: null,
      answers: draftAnswers
    }
    expect(studyDraftSnapshotSchema.parse(initial)).toEqual(initial)
    expect(getStudyDraftAnswersResponseSchema.parse(initial)).toEqual(initial)
    expect(
      saveStudyDraftAnswersResponseSchema.parse({
        ...initial,
        revision: 1,
        savedAt: '2026-08-17T01:01:00.000Z'
      }).revision
    ).toBe(1)
    expect(
      saveStudyDraftAnswersBodySchema.parse({
        expectedRevision: 0,
        currentOrdinal: 1,
        answers: draftAnswers
      }).expectedRevision
    ).toBe(0)

    for (const invalid of [
      { ...initial, revision: 0, savedAt: '2026-08-17T01:01:00.000Z' },
      { ...initial, revision: 1, savedAt: null },
      { ...initial, currentOrdinal: 2 },
      { ...initial, answers: [draftAnswers[0], draftAnswers[0]] },
      {
        ...initial,
        answers: [{ ...draftAnswers[0], elapsedSec: 86_401 }]
      },
      { ...initial, correctOptionId: id(20) }
    ]) {
      expect(studyDraftSnapshotSchema.safeParse(invalid).success).toBe(false)
    }
  })

  it('resumable v1/v2 metadata와 pagination integrity를 강제한다', () => {
    const common = {
      id: id(1),
      level: 'N5',
      subject: 'VOCABULARY',
      mode: 'RANDOM',
      status: 'IN_PROGRESS',
      actualCount: 1,
      startedAt: '2026-08-17T01:00:00.000Z',
      expiresAt: '2026-08-18T01:00:00.000Z'
    }
    const legacy = {
      ...common,
      practiceContractVersion: 1,
      draftRevision: null,
      draftSavedAt: null,
      currentOrdinal: null,
      resumeAvailability: 'LEGACY_LOCAL_ONLY'
    }
    const server = {
      ...common,
      practiceContractVersion: 2,
      draftRevision: 0,
      draftSavedAt: null,
      currentOrdinal: 1,
      resumeAvailability: 'SERVER'
    }

    expect(resumableStudySessionSummarySchema.parse(legacy)).toEqual(legacy)
    expect(resumableStudySessionSummarySchema.parse(server)).toEqual(server)
    expect(
      resumableStudySessionSummarySchema.safeParse({
        ...server,
        resumeAvailability: 'LEGACY_LOCAL_ONLY'
      }).success
    ).toBe(false)
    expect(
      resumableStudySessionSummarySchema.safeParse({
        ...server,
        draftRevision: 1,
        draftSavedAt: null
      }).success
    ).toBe(false)
    expect(
      listResumableStudySessionsResponseSchema.safeParse({
        items: [server, server],
        page: 1,
        pageSize: 20,
        total: 2
      }).success
    ).toBe(false)
    expect(
      listResumableStudySessionsResponseSchema.safeParse({
        items: [server],
        page: 2,
        pageSize: 20,
        total: 1
      }).success
    ).toBe(false)
    expect(
      listResumableStudySessionsResponseSchema.safeParse({
        items: [server],
        page: 1,
        pageSize: 20,
        total: 2
      }).success
    ).toBe(false)
    expect(
      listResumableStudySessionsQuerySchema.parse({ status: 'IN_PROGRESS' })
    ).toEqual({ status: 'IN_PROGRESS', page: 1, pageSize: 20 })
    expect(listResumableStudySessionsQuerySchema.safeParse({}).success).toBe(
      false
    )
  })

  it('lifecycle params·headers·empty body와 v2 retry response를 고정한다', () => {
    for (const paramsSchema of [
      getStudyDraftAnswersParamsSchema,
      saveStudyDraftAnswersParamsSchema,
      cancelStudySessionParamsSchema,
      createResultRetrySessionParamsSchema
    ]) {
      expect(paramsSchema.parse({ sessionId: id(1).toUpperCase() })).toEqual({
        sessionId: id(1)
      })
    }

    expect(
      listResumableStudySessionsHeadersSchema.parse({
        'x-nihongo-practice-contract': '2'
      })
    ).toEqual({ 'x-nihongo-practice-contract': '2' })
    expect(
      getStudyDraftAnswersHeadersSchema.parse({
        'x-nihongo-practice-contract': '2'
      })
    ).toEqual({ 'x-nihongo-practice-contract': '2' })
    for (const headerSchema of [
      saveStudyDraftAnswersHeadersSchema,
      createResultRetrySessionHeadersSchema
    ]) {
      expect(
        headerSchema.parse({
          'idempotency-key': id(99),
          'x-nihongo-practice-contract': '2'
        })
      ).toEqual({
        'idempotency-key': id(99),
        'x-nihongo-practice-contract': '2'
      })
    }
    expect(
      cancelStudySessionHeadersSchema.parse({
        'x-nihongo-practice-contract': '2'
      })
    ).toEqual({ 'x-nihongo-practice-contract': '2' })

    expect(cancelStudySessionBodySchema.parse({})).toEqual({})
    expect(createResultRetrySessionBodySchema.parse({})).toEqual({})
    expect(
      cancelStudySessionBodySchema.safeParse({ reason: 'user' }).success
    ).toBe(false)

    expect(
      createResultRetrySessionResponseSchema.parse({
        ...basePayload,
        session: { ...baseSession, practiceContractVersion: 2 }
      }).session.practiceContractVersion
    ).toBe(2)
    expect(
      createResultRetrySessionResponseSchema.safeParse({
        ...basePayload,
        session: {
          ...baseSession,
          mode: 'WEAKNESS',
          practiceContractVersion: 2
        }
      }).success
    ).toBe(false)
  })

  it('operation별 error option set을 exact equality로 고정한다', () => {
    expect(listResumableStudySessionsErrorCodeSchema.options).toEqual(
      failureCodes.resumable
    )
    expect(getStudyDraftAnswersErrorCodeSchema.options).toEqual(
      failureCodes.draftGet
    )
    expect(saveStudyDraftAnswersErrorCodeSchema.options).toEqual(
      failureCodes.draftSave
    )
    expect(cancelStudySessionErrorCodeSchema.options).toEqual(
      failureCodes.cancel
    )
    expect(createResultRetrySessionErrorCodeSchema.options).toEqual(
      failureCodes.retry
    )

    expect(getStudySessionErrorCodeSchema.options).toEqual([
      'INVALID_ID',
      'AUTHENTICATION_REQUIRED',
      'AUTH_SESSION_EXPIRED',
      'GUEST_SESSION_EXPIRED',
      'RESOURCE_NOT_FOUND',
      'INVALID_REQUEST',
      'PRACTICE_CONTRACT_VERSION_MISMATCH',
      'RATE_LIMITED',
      'INTERNAL_SERVER_ERROR',
      'SERVICE_UNAVAILABLE'
    ])
  })
})
