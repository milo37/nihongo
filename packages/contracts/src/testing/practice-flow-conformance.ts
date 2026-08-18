import type { BookmarkSummary } from '../bookmark/bookmark.js'
import { createBookmarkOperationId } from '../bookmark/create-bookmark.js'
import { deleteBookmarkOperationId } from '../bookmark/delete-bookmark.js'
import { listBookmarksOperationId } from '../bookmark/list-bookmarks.js'
import { cancelStudySessionOperationId } from '../study/cancel-study-session.js'
import { createResultRetrySessionOperationId } from '../study/create-result-retry-session.js'
import { getStudyDraftAnswersOperationId } from '../study/get-study-draft-answers.js'
import type { ResumableStudySessionSummary } from '../study/list-resumable-study-sessions.js'
import { listResumableStudySessionsOperationId } from '../study/list-resumable-study-sessions.js'
import { saveStudyDraftAnswersOperationId } from '../study/save-study-draft-answers.js'
import type { StudyDraftSnapshot } from '../study/study-draft.js'
import type { VersionedStudySessionPayload } from '../study/study-session.js'

export const preSubmitForbiddenKeys = [
  'correctOptionId',
  'isCorrect',
  'explanationKo',
  'explanationJa',
  'userId',
  'guestPrincipalId',
  'ownerId',
  'createdByUserId',
  'publishedByUserId',
  'passwordHash',
  'sourceType',
  'rowVersion',
  'createdByLabelSnapshot',
  'lifecycleStatus',
  'publishedAt',
  'retiredAt',
  'archivedAt'
] as const

const preSubmitForbiddenKeySet = new Set<string>(preSubmitForbiddenKeys)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const findPreSubmitForbiddenKeyPaths = (
  value: unknown,
  parentPath = '$'
): string[] => {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      findPreSubmitForbiddenKeyPaths(item, `${parentPath}[${index}]`)
    )
  }

  if (!isRecord(value)) {
    return []
  }

  return Object.entries(value).flatMap(([key, child]) => {
    const path = `${parentPath}.${key}`
    const current = preSubmitForbiddenKeySet.has(key) ? [path] : []

    return [...current, ...findPreSubmitForbiddenKeyPaths(child, path)]
  })
}

export const assertNoPreSubmitForbiddenKeys = (value: unknown): void => {
  const forbiddenPaths = findPreSubmitForbiddenKeyPaths(value)

  if (forbiddenPaths.length > 0) {
    throw new Error(
      `Pre-submit payload에 금지된 key가 있습니다: ${forbiddenPaths.join(', ')}`
    )
  }
}

export const assertStudyDraftFullCoverage = (
  snapshot: StudyDraftSnapshot,
  expectedSessionQuestionIds: readonly string[]
): void => {
  const actualIds = snapshot.answers.map(
    (answer) => answer.studySessionQuestionId
  )

  if (
    actualIds.length !== expectedSessionQuestionIds.length ||
    actualIds.some((id, index) => id !== expectedSessionQuestionIds[index])
  ) {
    throw new Error(
      'Study draft answer는 session ordinal 순서의 full snapshot이어야 합니다.'
    )
  }
}

export const assertSessionPracticeContractHeaderMatchesBody = (
  payload:
    | VersionedStudySessionPayload
    | (Omit<VersionedStudySessionPayload, 'session'> & {
        session: Omit<
          VersionedStudySessionPayload['session'],
          'practiceContractVersion'
        >
      }),
  responseHeader: '1' | '2'
): void => {
  const version =
    'practiceContractVersion' in payload.session
      ? payload.session.practiceContractVersion
      : 1

  if (String(version) !== responseHeader) {
    throw new Error(
      'StudySession body contract version과 response practice header가 일치해야 합니다.'
    )
  }
}

export interface PracticeRouteConformanceCase {
  readonly operationId: string
  readonly method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  readonly path: string
  readonly successStatuses: readonly number[]
  readonly responseBody: 'JSON' | 'NONE'
  readonly requiredResponseHeaders: readonly PracticeRouteHeaderExpectation[]
  readonly conditionalResponseHeaders: readonly PracticeRouteConditionalHeaderExpectation[]
  readonly forbiddenResponseHeaders: readonly string[]
}

export interface PracticeRouteHeaderExpectation {
  readonly name: string
  readonly expectedValue: string
  readonly match: 'EXACT' | 'OPAQUE_ID' | 'PATH_TEMPLATE'
}

export interface PracticeRouteConditionalHeaderExpectation
  extends PracticeRouteHeaderExpectation {
  readonly when: 'IDEMPOTENCY_REPLAY'
}

const COMMON_JSON_HEADERS = [
  {
    name: 'Cache-Control',
    expectedValue: 'private, no-store',
    match: 'EXACT'
  },
  {
    name: 'X-Request-ID',
    expectedValue: 'opaque UUID',
    match: 'OPAQUE_ID'
  }
] as const satisfies readonly PracticeRouteHeaderExpectation[]
const PRACTICE_V2_HEADER = {
  name: 'X-Nihongo-Practice-Contract',
  expectedValue: '2',
  match: 'EXACT'
} as const satisfies PracticeRouteHeaderExpectation
const REQUEST_ID_HEADER = COMMON_JSON_HEADERS[1]
const REPLAY_HEADER = {
  name: 'Idempotency-Replayed',
  expectedValue: 'true',
  match: 'EXACT',
  when: 'IDEMPOTENCY_REPLAY'
} as const satisfies PracticeRouteConditionalHeaderExpectation

export const practiceRouteConformanceCases = [
  {
    operationId: listResumableStudySessionsOperationId,
    method: 'GET',
    path: '/api/v1/study-sessions',
    successStatuses: [200],
    responseBody: 'JSON',
    requiredResponseHeaders: [...COMMON_JSON_HEADERS, PRACTICE_V2_HEADER],
    conditionalResponseHeaders: [],
    forbiddenResponseHeaders: []
  },
  {
    operationId: getStudyDraftAnswersOperationId,
    method: 'GET',
    path: '/api/v1/study-sessions/:sessionId/draft-answers',
    successStatuses: [200],
    responseBody: 'JSON',
    requiredResponseHeaders: [...COMMON_JSON_HEADERS, PRACTICE_V2_HEADER],
    conditionalResponseHeaders: [],
    forbiddenResponseHeaders: []
  },
  {
    operationId: saveStudyDraftAnswersOperationId,
    method: 'PUT',
    path: '/api/v1/study-sessions/:sessionId/draft-answers',
    successStatuses: [200],
    responseBody: 'JSON',
    requiredResponseHeaders: [...COMMON_JSON_HEADERS, PRACTICE_V2_HEADER],
    conditionalResponseHeaders: [REPLAY_HEADER],
    forbiddenResponseHeaders: []
  },
  {
    operationId: cancelStudySessionOperationId,
    method: 'POST',
    path: '/api/v1/study-sessions/:sessionId/cancellation',
    successStatuses: [204],
    responseBody: 'NONE',
    requiredResponseHeaders: [REQUEST_ID_HEADER, PRACTICE_V2_HEADER],
    conditionalResponseHeaders: [],
    forbiddenResponseHeaders: ['Content-Type']
  },
  {
    operationId: createResultRetrySessionOperationId,
    method: 'POST',
    path: '/api/v1/study-sessions/:sessionId/retry',
    successStatuses: [201],
    responseBody: 'JSON',
    requiredResponseHeaders: [
      ...COMMON_JSON_HEADERS,
      PRACTICE_V2_HEADER,
      {
        name: 'Location',
        expectedValue: '/api/v1/study-sessions/:targetSessionId',
        match: 'PATH_TEMPLATE'
      }
    ],
    conditionalResponseHeaders: [REPLAY_HEADER],
    forbiddenResponseHeaders: []
  },
  {
    operationId: listBookmarksOperationId,
    method: 'GET',
    path: '/api/v1/bookmarks',
    successStatuses: [200],
    responseBody: 'JSON',
    requiredResponseHeaders: COMMON_JSON_HEADERS,
    conditionalResponseHeaders: [],
    forbiddenResponseHeaders: []
  },
  {
    operationId: createBookmarkOperationId,
    method: 'PUT',
    path: '/api/v1/bookmarks/:questionId',
    successStatuses: [200, 201],
    responseBody: 'JSON',
    requiredResponseHeaders: [
      ...COMMON_JSON_HEADERS,
      {
        name: 'Location',
        expectedValue: '/api/v1/bookmarks/:questionId',
        match: 'PATH_TEMPLATE'
      }
    ],
    conditionalResponseHeaders: [],
    forbiddenResponseHeaders: []
  },
  {
    operationId: deleteBookmarkOperationId,
    method: 'DELETE',
    path: '/api/v1/bookmarks/:questionId',
    successStatuses: [204],
    responseBody: 'NONE',
    requiredResponseHeaders: [REQUEST_ID_HEADER],
    conditionalResponseHeaders: [],
    forbiddenResponseHeaders: ['Content-Type']
  }
] as const satisfies readonly PracticeRouteConformanceCase[]

const id = (index: number): string =>
  `018f6b7a-1f4b-7d5e-8a91-${index.toString(16).padStart(12, '0')}`

const publicQuestionSummary: BookmarkSummary['question'] = {
  id: id(10),
  questionVersionId: id(11),
  level: 'N5',
  subject: 'VOCABULARY',
  questionType: 'KANJI_READING',
  difficulty: 'EASY',
  questionTextPreview: '「川」의 읽는 법은 어느 것입니까.',
  tags: [{ id: id(12), label: '한자 읽기' }]
}

const publicPracticeQuestion: VersionedStudySessionPayload['questions'][number]['question'] =
  {
    id: publicQuestionSummary.id,
    questionVersionId: publicQuestionSummary.questionVersionId,
    level: publicQuestionSummary.level,
    subject: publicQuestionSummary.subject,
    questionType: publicQuestionSummary.questionType,
    difficulty: publicQuestionSummary.difficulty,
    tags: publicQuestionSummary.tags,
    passage: null,
    questionText: publicQuestionSummary.questionTextPreview,
    options: ['かわ', 'やま', 'うみ', 'そら'].map((text, index) => ({
      id: id(20 + index),
      label: String(index + 1) as '1' | '2' | '3' | '4',
      text
    }))
  }

export const practiceFlowConformanceFixture = {
  sessionQuestionIds: [id(2)] as const,
  session: {
    session: {
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
      durationSec: null,
      practiceContractVersion: 2
    },
    questions: [
      {
        sessionQuestionId: id(2),
        ordinal: 1,
        question: publicPracticeQuestion
      }
    ]
  } satisfies VersionedStudySessionPayload,
  draft: {
    studySessionId: id(1),
    revision: 1,
    currentOrdinal: 1,
    savedAt: '2026-08-17T01:01:00.000Z',
    answers: [
      {
        studySessionQuestionId: id(2),
        selectedOptionId: null,
        elapsedSec: 12
      }
    ]
  } satisfies StudyDraftSnapshot,
  resumable: {
    id: id(1),
    level: 'N5',
    subject: 'VOCABULARY',
    mode: 'RANDOM',
    status: 'IN_PROGRESS',
    actualCount: 1,
    startedAt: '2026-08-17T01:00:00.000Z',
    expiresAt: '2026-08-18T01:00:00.000Z',
    practiceContractVersion: 2,
    draftRevision: 1,
    draftSavedAt: '2026-08-17T01:01:00.000Z',
    currentOrdinal: 1,
    resumeAvailability: 'SERVER'
  } satisfies ResumableStudySessionSummary,
  bookmark: {
    questionId: id(10),
    question: publicQuestionSummary,
    availability: 'AVAILABLE',
    createdAt: '2026-08-17T01:02:00.000Z'
  } satisfies BookmarkSummary
} as const
