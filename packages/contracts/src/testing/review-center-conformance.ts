import { createStudySessionOperationId } from '../study/create-study-session.js'
import type { CreateStudySessionV2Body } from '../study/create-study-session.js'
import type { VersionedStudySessionPayload } from '../study/study-session.js'
import { createTargetedReviewSessionOperationId } from '../wrong-note/create-targeted-review-session.js'
import type { CreateTargetedReviewSessionResponse } from '../wrong-note/create-targeted-review-session.js'
import { getWrongNoteMemoOperationId } from '../wrong-note/get-wrong-note-memo.js'
import { listReviewEventsOperationId } from '../wrong-note/list-review-events.js'
import {
  encodeReviewEventCursor,
  type ListReviewEventsResponse
} from '../wrong-note/list-review-events.js'
import { listReviewQueueOperationId } from '../wrong-note/list-review-queue.js'
import type {
  ListReviewQueueResponse,
  ReviewQueueItem
} from '../wrong-note/list-review-queue.js'
import { updateWrongNoteMemoOperationId } from '../wrong-note/update-wrong-note-memo.js'
import type { UserMemo } from '../wrong-note/user-memo.js'
import type {
  PracticeRouteConditionalHeaderExpectation,
  PracticeRouteConformanceCase,
  PracticeRouteHeaderExpectation
} from './practice-flow-conformance.js'
import { practiceFlowConformanceFixture } from './practice-flow-conformance.js'

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

const REPLAY_HEADER = {
  name: 'Idempotency-Replayed',
  expectedValue: 'true',
  match: 'EXACT',
  when: 'IDEMPOTENCY_REPLAY'
} as const satisfies PracticeRouteConditionalHeaderExpectation

export const reviewCenterRouteConformanceCases = [
  {
    operationId: listReviewQueueOperationId,
    method: 'GET',
    path: '/api/v1/review-queue',
    successStatuses: [200],
    responseBody: 'JSON',
    requiredResponseHeaders: COMMON_JSON_HEADERS,
    conditionalResponseHeaders: [],
    forbiddenResponseHeaders: []
  },
  {
    operationId: getWrongNoteMemoOperationId,
    method: 'GET',
    path: '/api/v1/wrong-notes/:questionId/memo',
    successStatuses: [200],
    responseBody: 'JSON',
    requiredResponseHeaders: COMMON_JSON_HEADERS,
    conditionalResponseHeaders: [],
    forbiddenResponseHeaders: []
  },
  {
    operationId: updateWrongNoteMemoOperationId,
    method: 'PUT',
    path: '/api/v1/wrong-notes/:questionId/memo',
    successStatuses: [200],
    responseBody: 'JSON',
    requiredResponseHeaders: COMMON_JSON_HEADERS,
    conditionalResponseHeaders: [],
    forbiddenResponseHeaders: []
  },
  {
    operationId: listReviewEventsOperationId,
    method: 'GET',
    path: '/api/v1/wrong-notes/:questionId/review-events',
    successStatuses: [200],
    responseBody: 'JSON',
    requiredResponseHeaders: COMMON_JSON_HEADERS,
    conditionalResponseHeaders: [],
    forbiddenResponseHeaders: []
  },
  {
    operationId: createTargetedReviewSessionOperationId,
    method: 'POST',
    path: '/api/v1/wrong-notes/:questionId/review-session',
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
    operationId: createStudySessionOperationId,
    method: 'POST',
    path: '/api/v1/study-sessions',
    successStatuses: [201],
    responseBody: 'JSON',
    requiredResponseHeaders: [...COMMON_JSON_HEADERS, PRACTICE_V2_HEADER],
    conditionalResponseHeaders: [],
    forbiddenResponseHeaders: []
  }
] as const satisfies readonly PracticeRouteConformanceCase[]

export type ReviewCenterPayloadKind =
  | 'QUEUE'
  | 'MEMO'
  | 'HISTORY'
  | 'TARGETED_SESSION'

const commonForbiddenKeys = [
  'userId',
  'guestPrincipalId',
  'ownerId',
  'createdByUserId',
  'publishedByUserId',
  'passwordHash',
  'requestId',
  'requestHash',
  'payloadHash',
  'idempotencyKey',
  'cookie',
  'sessionToken',
  'token',
  'actorId',
  'internalActor',
  'auditMetadata',
  'adminMetadata',
  'reviewedByUserId',
  'owner',
  'actor',
  'audit',
  'admin',
  'answer',
  'explanation',
  'studyAnswer',
  'studySession',
  'wrongNote',
  'questionVersion',
  'user',
  'guestPrincipal',
  'idempotencyRecord',
  'reviewSchedule',
  'schedule',
  'events',
  'lastWrongQuestionVersion',
  'currentReviewQuestionVersion',
  'selectedOption',
  'wrongNoteId',
  'studyAnswerId',
  'studySessionId',
  'sourceType',
  'rowVersion',
  'createdByLabelSnapshot',
  'lifecycleStatus',
  'publishedAt',
  'retiredAt',
  'archivedAt'
] as const

const forbiddenKeysByKind = {
  QUEUE: [
    ...commonForbiddenKeys,
    'question',
    'correctOptionId',
    'selectedOptionId',
    'isCorrect',
    'explanationKo',
    'explanationJa',
    'memo',
    'text'
  ],
  MEMO: [
    ...commonForbiddenKeys,
    'question',
    'correctOptionId',
    'selectedOptionId',
    'isCorrect',
    'explanationKo',
    'explanationJa',
    'memo',
    'id'
  ],
  HISTORY: [
    ...commonForbiddenKeys,
    'question',
    'correctOptionId',
    'explanationKo',
    'explanationJa',
    'memo',
    'text'
  ],
  TARGETED_SESSION: [
    ...commonForbiddenKeys,
    'correctOptionId',
    'selectedOptionId',
    'isCorrect',
    'explanationKo',
    'explanationJa',
    'memo'
  ]
} as const satisfies Record<ReviewCenterPayloadKind, readonly string[]>

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const findReviewCenterForbiddenKeyPaths = (
  kind: ReviewCenterPayloadKind,
  value: unknown,
  parentPath = '$'
): string[] => {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      findReviewCenterForbiddenKeyPaths(kind, item, `${parentPath}[${index}]`)
    )
  }

  if (!isRecord(value)) {
    return []
  }

  const forbiddenKeys = new Set<string>(forbiddenKeysByKind[kind])

  return Object.entries(value).flatMap(([key, child]) => {
    const path = `${parentPath}.${key}`
    const current = forbiddenKeys.has(key) ? [path] : []

    return [...current, ...findReviewCenterForbiddenKeyPaths(kind, child, path)]
  })
}

export const assertNoReviewCenterForbiddenKeys = (
  kind: ReviewCenterPayloadKind,
  value: unknown
): void => {
  const forbiddenPaths = findReviewCenterForbiddenKeyPaths(kind, value)

  if (forbiddenPaths.length > 0) {
    throw new Error(
      `${kind} payload에 금지된 key가 있습니다: ${forbiddenPaths.join(', ')}`
    )
  }
}

const id = (index: number): string =>
  `018f6b7a-1f4b-7d5e-8a91-${index.toString(16).padStart(12, '0')}`

const queueItem = {
  questionId: id(10),
  currentQuestionVersionId: id(11),
  level: 'N5',
  subject: 'VOCABULARY',
  questionType: 'KANJI_READING',
  questionPreview: '「川」의 읽는 법은 어느 것입니까.',
  tags: ['한자 읽기'],
  status: 'AGAIN',
  wrongCount: 2,
  correctStreak: 0,
  lastWrongAt: '2026-08-21T02:00:00.000Z',
  lastReviewedAt: '2026-08-21T02:00:00.000Z',
  nextReviewAt: '2026-08-22T02:00:00.000Z',
  hasMemo: true
} satisfies ReviewQueueItem

const memo = {
  questionId: queueItem.questionId,
  text: '川은 かわ라고 읽는다.',
  createdAt: '2026-08-21T02:30:00.000Z',
  updatedAt: '2026-08-21T02:30:00.000Z'
} as const satisfies UserMemo

const olderEvent = {
  id: id(30),
  source: 'STUDY_SUBMIT',
  questionVersionId: queueItem.currentQuestionVersionId,
  selectedOptionId: null,
  isCorrect: false,
  elapsedSec: 12,
  previousStatus: null,
  nextStatus: 'NEW',
  previousCorrectStreak: null,
  nextCorrectStreak: 0,
  previousWrongCount: null,
  wrongCountAfter: 1,
  algorithmVersion: 1,
  occurredAt: '2026-08-21T01:00:00.000Z'
} as const

const newerEvent = {
  id: id(31),
  source: 'WRONG_NOTE_REVIEW',
  questionVersionId: queueItem.currentQuestionVersionId,
  selectedOptionId: id(21),
  isCorrect: false,
  elapsedSec: 8,
  previousStatus: 'NEW',
  nextStatus: 'AGAIN',
  previousCorrectStreak: 0,
  nextCorrectStreak: 0,
  previousWrongCount: 1,
  wrongCountAfter: 2,
  algorithmVersion: 1,
  occurredAt: '2026-08-21T02:00:00.000Z'
} as const

const targetedSession = {
  ...practiceFlowConformanceFixture.session,
  session: {
    ...practiceFlowConformanceFixture.session.session,
    mode: 'WRONG_NOTE',
    requestedCount: 1,
    actualCount: 1,
    usedFallback: false,
    fallbackReason: null,
    startedAt: '2026-08-22T03:05:00.000Z',
    expiresAt: '2026-08-23T03:05:00.000Z',
    practiceContractVersion: 2
  }
} as const satisfies VersionedStudySessionPayload

export const reviewCenterConformanceFixture = {
  queue: {
    items: [queueItem],
    page: 1,
    pageSize: 20,
    total: 1,
    counts: { due: 1, unreviewed: 0, repeated: 1, solved: 0 },
    availableTags: ['한자 읽기'],
    observedAt: '2026-08-22T03:00:00.000Z'
  } satisfies ListReviewQueueResponse,
  memo,
  history: {
    items: [newerEvent, olderEvent],
    nextCursor: null
  } satisfies ListReviewEventsResponse,
  nextHistoryCursor: encodeReviewEventCursor({
    v: 1,
    occurredAt: olderEvent.occurredAt,
    id: olderEvent.id
  }),
  targetedQuestionId: queueItem.questionId,
  targetedCanonicalMaterial:
    'study-targeted-review-v1\n018f6b7a-1f4b-7d5e-8a91-00000000000a',
  targetedSha256:
    '063d282b8e8aa91f64fb907c9f1d23046bd2d4cafe63192e54066e9505daad47',
  targetedLocation: `/api/v1/study-sessions/${targetedSession.session.id}`,
  targetedSession:
    targetedSession satisfies CreateTargetedReviewSessionResponse,
  filteredCreateBody: {
    level: 'N5',
    subject: 'VOCABULARY',
    mode: 'DAILY_REVIEW',
    count: 20,
    reviewFilter: {
      questionType: 'KANJI_READING',
      tag: '한자 읽기'
    }
  } satisfies CreateStudySessionV2Body
} as const
