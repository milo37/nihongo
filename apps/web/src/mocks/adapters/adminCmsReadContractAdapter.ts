import {
  assertDiffQuestionVersionForRequest,
  assertGetAdminQuestionForRequest,
  assertListAdminAuditLogForRequest,
  assertListAdminQuestionsForRequest,
  assertListAdminQuestionVersionsForRequest,
  assertListAdminTagsForRequest,
  assertListQuestionVersionReviewsForRequest,
  assertPreviewQuestionVersionForRequest,
  compareAdminTags,
  compareUnicodeScalars,
  decodeAdminQuestionVersionCursor,
  normalizePhase7TagKey,
  type AdminQuestionSummary,
  type AdminQuestionVersionSummary,
  type DiffQuestionVersionQuery,
  type DiffQuestionVersionResponse,
  type GetAdminQuestionResponse,
  type ListAdminAuditLogQuery,
  type ListAdminAuditLogResponse,
  type ListAdminQuestionsQuery,
  type ListAdminQuestionsResponse,
  type ListAdminQuestionVersionsQuery,
  type ListAdminQuestionVersionsResponse,
  type ListAdminTagsQuery,
  type ListAdminTagsResponse,
  type ListQuestionVersionReviewsQuery,
  type ListQuestionVersionReviewsResponse,
  type PreviewQuestionVersionResponse
} from '@nihongo/contracts/admin/phase7'
import {
  getContractQuestionId,
  getQuestionVersionFingerprint,
  toContractPracticeQuestion,
  toStableMockUuid
} from '@mocks/adapters/questionContractAdapter'
import type { MockCanonicalAdminQuestionSource } from '@mocks/repository/mockDatabase'
import { toPracticeQuestion } from '@util/question'

const QUESTION_PREVIEW_MAX_LENGTH = 160

export class MockAdminCmsReadNotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MockAdminCmsReadNotFoundError'
  }
}

export class MockAdminCmsReadIntegrityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MockAdminCmsReadIntegrityError'
  }
}

const createQuestionTextPreview = (value: string): string => {
  const scalars = [...value]

  return scalars.length <= QUESTION_PREVIEW_MAX_LENGTH
    ? value
    : `${scalars.slice(0, QUESTION_PREVIEW_MAX_LENGTH - 3).join('')}...`
}

const getVersionId = (source: MockCanonicalAdminQuestionSource): string =>
  toStableMockUuid(
    'question-version',
    `${source.question.id}:${getQuestionVersionFingerprint(source.question)}`
  )

const toAdminTags = (source: MockCanonicalAdminQuestionSource) =>
  source.question.tags
    .map((label) => {
      const normalizedName = normalizePhase7TagKey(label)

      return {
        id: toStableMockUuid('question-tag', normalizedName),
        label,
        normalizedName
      }
    })
    .toSorted(compareAdminTags)

const calculateCorrectRateBasisPoints = (
  answerCount: number,
  correctCount: number
): number | null => {
  if (answerCount === 0) {
    return null
  }

  const answer = BigInt(answerCount)
  const numerator = BigInt(correctCount) * 10_000n

  return Number((numerator * 2n + answer) / (answer * 2n))
}

const toVersionSummary = (
  source: MockCanonicalAdminQuestionSource
): AdminQuestionVersionSummary => ({
  questionVersionId: getVersionId(source),
  versionNumber: 1,
  versionStatus: 'PUBLISHED',
  retirementKind: null,
  rowVersion: 1,
  provenance: 'SYSTEM_SEED',
  level: source.question.level,
  subject: source.question.subject,
  questionType: source.question.questionType,
  difficulty: source.question.difficulty,
  questionTextPreview: createQuestionTextPreview(source.question.questionText),
  tags: toAdminTags(source),
  author: null,
  latestReviewer: null,
  publishedAt: source.question.createdAt,
  retiredAt: null,
  createdAt: source.question.createdAt,
  updatedAt: source.question.updatedAt
})

const toQuestionSummary = (
  source: MockCanonicalAdminQuestionSource
): AdminQuestionSummary => {
  const versionId = getVersionId(source)

  return {
    questionId: getContractQuestionId(source.question.id),
    selectedVersionId: versionId,
    currentPublishedVersionId: versionId,
    openCandidateVersionId: null,
    versionNumber: 1,
    lifecycleStatus: 'ACTIVE',
    versionStatus: 'PUBLISHED',
    retirementKind: null,
    questionRowVersion: 1,
    versionRowVersion: 1,
    level: source.question.level,
    subject: source.question.subject,
    questionType: source.question.questionType,
    difficulty: source.question.difficulty,
    questionTextPreview: createQuestionTextPreview(
      source.question.questionText
    ),
    tags: toAdminTags(source),
    author: null,
    latestReviewer: null,
    createdAt: source.question.createdAt,
    updatedAt: source.question.updatedAt,
    answerCount: source.answerCount,
    correctRateBasisPoints: calculateCorrectRateBasisPoints(
      source.answerCount,
      source.correctCount
    ),
    openReportCount: 0
  }
}

const compareQuestionSummaries = (
  sort: ListAdminQuestionsQuery['sort'],
  left: AdminQuestionSummary,
  right: AdminQuestionSummary
): number => {
  switch (sort) {
    case 'UPDATED_DESC':
      return (
        compareUnicodeScalars(right.updatedAt, left.updatedAt) ||
        compareUnicodeScalars(right.questionId, left.questionId)
      )
    case 'CREATED_DESC':
      return (
        compareUnicodeScalars(right.createdAt, left.createdAt) ||
        compareUnicodeScalars(right.questionId, left.questionId)
      )
    case 'LEVEL_ASC': {
      const levels = ['N5', 'N4', 'N3', 'N2', 'N1'] as const

      return (
        levels.indexOf(left.level) - levels.indexOf(right.level) ||
        compareUnicodeScalars(left.questionId, right.questionId)
      )
    }
    case 'REPORT_COUNT_DESC':
      return (
        right.openReportCount - left.openReportCount ||
        compareUnicodeScalars(right.updatedAt, left.updatedAt) ||
        compareUnicodeScalars(right.questionId, left.questionId)
      )
  }
}

const isInHalfOpenRange = (
  value: string,
  from: string | undefined,
  to: string | undefined
): boolean =>
  (from === undefined || value >= from) && (to === undefined || value < to)

const findSourceByQuestionId = (
  sources: readonly MockCanonicalAdminQuestionSource[],
  questionId: string
): MockCanonicalAdminQuestionSource => {
  const source = sources.find(
    (candidate) => getContractQuestionId(candidate.question.id) === questionId
  )

  if (!source) {
    throw new MockAdminCmsReadNotFoundError('관리자 문제를 찾을 수 없습니다.')
  }

  return source
}

const findSourceByVersionId = (
  sources: readonly MockCanonicalAdminQuestionSource[],
  versionId: string
): MockCanonicalAdminQuestionSource => {
  const source = sources.find(
    (candidate) => getVersionId(candidate) === versionId
  )

  if (!source) {
    throw new MockAdminCmsReadNotFoundError('문제 버전을 찾을 수 없습니다.')
  }

  return source
}

export const toCanonicalAdminQuestionList = (
  sources: readonly MockCanonicalAdminQuestionSource[],
  query: ListAdminQuestionsQuery
): ListAdminQuestionsResponse => {
  const matches = sources
    .map(toQuestionSummary)
    .filter(
      (item) =>
        (query.q === undefined ||
          item.questionTextPreview.startsWith(query.q)) &&
        (query.level === undefined || item.level === query.level) &&
        (query.subject === undefined || item.subject === query.subject) &&
        (query.questionType === undefined ||
          item.questionType === query.questionType) &&
        (query.difficulty === undefined ||
          item.difficulty === query.difficulty) &&
        (query.lifecycleStatus === undefined ||
          item.lifecycleStatus === query.lifecycleStatus) &&
        (query.versionStatus === undefined ||
          item.versionStatus === query.versionStatus) &&
        (query.tag === undefined ||
          item.tags.some((tag) => tag.normalizedName === query.tag)) &&
        (query.authorActorId === undefined ||
          item.author?.actorId === query.authorActorId) &&
        (query.reviewerActorId === undefined ||
          item.latestReviewer?.actorId === query.reviewerActorId) &&
        isInHalfOpenRange(item.createdAt, query.createdFrom, query.createdTo) &&
        isInHalfOpenRange(item.updatedAt, query.updatedFrom, query.updatedTo)
    )
    .toSorted((left, right) =>
      compareQuestionSummaries(query.sort, left, right)
    )
  const offset = (BigInt(query.page) - 1n) * BigInt(query.pageSize)
  const items =
    offset >= BigInt(matches.length)
      ? []
      : matches.slice(Number(offset), Number(offset) + query.pageSize)
  const response = {
    items,
    page: query.page,
    pageSize: query.pageSize,
    total: matches.length
  }

  return assertListAdminQuestionsForRequest(query, response)
}

export const toCanonicalAdminQuestionDetail = (
  sources: readonly MockCanonicalAdminQuestionSource[],
  questionId: string
): GetAdminQuestionResponse => {
  const source = findSourceByQuestionId(sources, questionId)
  const response = {
    question: {
      questionId,
      lifecycleStatus: 'ACTIVE' as const,
      rowVersion: 1,
      currentPublishedVersionId: getVersionId(source),
      openCandidateVersionId: null,
      createdAt: source.question.createdAt,
      updatedAt: source.question.updatedAt
    },
    versions: {
      questionId,
      items: [toVersionSummary(source)],
      nextCursor: null
    },
    auditSummary: {
      lastCommand: null,
      lastActor: null,
      lastOccurredAt: null,
      totalCount: 0
    }
  }

  return assertGetAdminQuestionForRequest({ questionId }, {}, response)
}

export const toCanonicalAdminQuestionVersions = (
  sources: readonly MockCanonicalAdminQuestionSource[],
  questionId: string,
  query: ListAdminQuestionVersionsQuery
): ListAdminQuestionVersionsResponse => {
  const source = findSourceByQuestionId(sources, questionId)
  const version = toVersionSummary(source)
  const cursor = query.cursor
    ? decodeAdminQuestionVersionCursor(query.cursor)
    : undefined
  const isAfterCursor =
    cursor === undefined ||
    version.versionNumber < cursor.versionNumber ||
    (version.versionNumber === cursor.versionNumber &&
      compareUnicodeScalars(version.questionVersionId, cursor.id) < 0)
  const response = {
    questionId,
    items: isAfterCursor ? [version] : [],
    nextCursor: null
  }

  return assertListAdminQuestionVersionsForRequest(
    { questionId },
    query,
    response
  )
}

export const toCanonicalAdminTagList = (
  sources: readonly MockCanonicalAdminQuestionSource[],
  query: ListAdminTagsQuery
): ListAdminTagsResponse => {
  const byNormalizedName = new Map<
    string,
    ReturnType<typeof toAdminTags>[number]
  >()

  for (const source of sources) {
    for (const tag of toAdminTags(source)) {
      const existing = byNormalizedName.get(tag.normalizedName)
      if (
        existing &&
        (existing.id !== tag.id || existing.label !== tag.label)
      ) {
        throw new MockAdminCmsReadIntegrityError(
          '동일 normalizedName의 태그 snapshot이 일치하지 않습니다.'
        )
      }
      byNormalizedName.set(tag.normalizedName, tag)
    }
  }

  const response = {
    items: [...byNormalizedName.values()]
      .filter((tag) => tag.normalizedName.startsWith(query.q))
      .toSorted(compareAdminTags)
      .slice(0, query.limit)
  }

  return assertListAdminTagsForRequest(query, response)
}

export const toCanonicalAdminQuestionPreview = (
  sources: readonly MockCanonicalAdminQuestionSource[],
  versionId: string
): PreviewQuestionVersionResponse => {
  const source = findSourceByVersionId(sources, versionId)
  const correctOptionIndex = source.question.options.findIndex(
    (option) => option.isCorrect
  )
  if (
    correctOptionIndex < 0 ||
    source.question.options.filter((option) => option.isCorrect).length !== 1
  ) {
    throw new MockAdminCmsReadIntegrityError(
      'preview source에는 정답 option이 정확히 하나여야 합니다.'
    )
  }
  const question = toContractPracticeQuestion(
    toPracticeQuestion(source.question),
    getQuestionVersionFingerprint(source.question)
  )
  const correctOption = question.options[correctOptionIndex]
  if (!correctOption) {
    throw new MockAdminCmsReadIntegrityError(
      'preview 정답 option projection을 찾을 수 없습니다.'
    )
  }
  const response = {
    question,
    adminAnswer: {
      correctOptionId: correctOption.id,
      explanationKo: source.question.explanationKo,
      explanationJa: source.question.explanationJa
    }
  }

  return assertPreviewQuestionVersionForRequest({ versionId }, {}, response)
}

export const toCanonicalAdminQuestionDiff = (
  sources: readonly MockCanonicalAdminQuestionSource[],
  versionId: string,
  query: DiffQuestionVersionQuery
): DiffQuestionVersionResponse => {
  const target = findSourceByVersionId(sources, versionId)
  const base = sources.find(
    (candidate) =>
      candidate.question.id === target.question.id &&
      getVersionId(candidate) === query.baseVersionId
  )
  if (!base) {
    throw new MockAdminCmsReadNotFoundError(
      '비교할 문제 버전을 찾을 수 없습니다.'
    )
  }
  const response = {
    baseVersionId: query.baseVersionId,
    targetVersionId: versionId,
    changedFields: [],
    changes: []
  }

  return assertDiffQuestionVersionForRequest({ versionId }, query, response)
}

export const toCanonicalAdminQuestionReviews = (
  sources: readonly MockCanonicalAdminQuestionSource[],
  versionId: string,
  query: ListQuestionVersionReviewsQuery
): ListQuestionVersionReviewsResponse => {
  findSourceByVersionId(sources, versionId)
  const response = {
    questionVersionId: versionId,
    items: [],
    nextCursor: null
  }

  return assertListQuestionVersionReviewsForRequest(
    { versionId },
    query,
    response
  )
}

export const toCanonicalAdminAuditLog = (
  query: ListAdminAuditLogQuery
): ListAdminAuditLogResponse =>
  assertListAdminAuditLogForRequest(query, {
    items: [],
    nextCursor: null
  })
