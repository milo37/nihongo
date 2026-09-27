import { comparePublicQuestionTags } from '@nihongo/contracts/question/get-question'
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
  decodePhase7OccurredAtCursor,
  encodeAdminQuestionVersionCursor,
  encodePhase7OccurredAtCursor,
  normalizePhase7TagKey,
  phase7DiffFieldOrder,
  type AdminAuditLogItem,
  type AdminQuestionSummary,
  type AdminQuestionVersionSummary,
  type AdminTagSummary,
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
  toStableMockUuid
} from '@mocks/adapters/questionContractAdapter'
import type { MockCanonicalAdminQuestionSource } from '@mocks/repository/mockDatabase'
import type {
  MockPhase7AdminCmsSnapshot,
  MockPhase7AdminQuestion,
  MockPhase7AdminVersion
} from '@mocks/repository/phase7AdminCmsState'

const QUESTION_PREVIEW_MAX_LENGTH = 160

export interface MockAdminCmsReadModel {
  readonly snapshot: MockPhase7AdminCmsSnapshot
  readonly sources: readonly MockCanonicalAdminQuestionSource[]
}

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
  const scalars = [...value.replaceAll('\n', ' ')]
  return scalars.length <= QUESTION_PREVIEW_MAX_LENGTH
    ? scalars.join('')
    : `${scalars.slice(0, QUESTION_PREVIEW_MAX_LENGTH - 3).join('')}...`
}

const calculateCorrectRateBasisPoints = (
  answerCount: number,
  correctCount: number
): number | null => {
  if (answerCount === 0) return null
  const answer = BigInt(answerCount)
  const numerator = BigInt(correctCount) * 10_000n
  return Number((numerator * 2n + answer) / (answer * 2n))
}

const findQuestion = (
  snapshot: MockPhase7AdminCmsSnapshot,
  questionId: string
): MockPhase7AdminQuestion => {
  const question = snapshot.questions.find(
    (candidate) => candidate.questionId === questionId
  )
  if (!question) {
    throw new MockAdminCmsReadNotFoundError('관리자 문제를 찾을 수 없습니다.')
  }
  return question
}

const findVersion = (
  snapshot: MockPhase7AdminCmsSnapshot,
  versionId: string
): MockPhase7AdminVersion => {
  const version = snapshot.versions.find(
    (candidate) => candidate.questionVersionId === versionId
  )
  if (!version) {
    throw new MockAdminCmsReadNotFoundError('문제 버전을 찾을 수 없습니다.')
  }
  return version
}

const listQuestionVersions = (
  snapshot: MockPhase7AdminCmsSnapshot,
  questionId: string
): MockPhase7AdminVersion[] =>
  snapshot.versions
    .filter((version) => version.questionId === questionId)
    .toSorted(
      (left, right) =>
        right.versionNumber - left.versionNumber ||
        compareUnicodeScalars(right.questionVersionId, left.questionVersionId)
    )

const selectQuestionVersion = (
  snapshot: MockPhase7AdminCmsSnapshot,
  question: MockPhase7AdminQuestion
): MockPhase7AdminVersion => {
  const selectedId =
    question.openCandidateVersionId ?? question.currentPublishedVersionId
  const selected = selectedId ? findVersion(snapshot, selectedId) : undefined
  const fallback = listQuestionVersions(snapshot, question.questionId)[0]
  if (!selected && !fallback) {
    throw new MockAdminCmsReadIntegrityError(
      '관리자 문제에는 최소 한 개의 버전이 필요합니다.'
    )
  }
  return selected ?? fallback!
}

const toVersionSummary = (
  version: MockPhase7AdminVersion
): AdminQuestionVersionSummary => ({
  questionVersionId: version.questionVersionId,
  versionNumber: version.versionNumber,
  versionStatus: version.versionStatus,
  retirementKind: version.retirementKind,
  rowVersion: version.rowVersion,
  provenance: version.provenance,
  level: version.level,
  subject: version.subject,
  questionType: version.questionType,
  difficulty: version.difficulty,
  questionTextPreview: createQuestionTextPreview(version.questionText),
  tags: [...version.tags],
  author: version.author,
  latestReviewer: version.latestReviewer,
  publishedAt: version.publishedAt,
  retiredAt: version.retiredAt,
  createdAt: version.createdAt,
  updatedAt: version.updatedAt
})

const answerStats = (
  model: MockAdminCmsReadModel,
  questionId: string,
  selectedVersionId: string
): { answerCount: number; correctCount: number } => {
  const source = model.sources.find(
    (candidate) => getContractQuestionId(candidate.question.id) === questionId
  )
  const publishedVersionId = source
    ? toStableMockUuid(
        'question-version',
        `${source.question.id}:${getQuestionVersionFingerprint(source.question)}`
      )
    : undefined
  return source && publishedVersionId === selectedVersionId
    ? { answerCount: source.answerCount, correctCount: source.correctCount }
    : { answerCount: 0, correctCount: 0 }
}

const toQuestionSummary = (
  model: MockAdminCmsReadModel,
  question: MockPhase7AdminQuestion
): AdminQuestionSummary => {
  const version = selectQuestionVersion(model.snapshot, question)
  const stats = answerStats(
    model,
    question.questionId,
    version.questionVersionId
  )
  return {
    questionId: question.questionId,
    selectedVersionId: version.questionVersionId,
    currentPublishedVersionId: question.currentPublishedVersionId,
    openCandidateVersionId: question.openCandidateVersionId,
    versionNumber: version.versionNumber,
    lifecycleStatus: question.lifecycleStatus,
    versionStatus: version.versionStatus,
    retirementKind: version.retirementKind,
    questionRowVersion: question.rowVersion,
    versionRowVersion: version.rowVersion,
    level: version.level,
    subject: version.subject,
    questionType: version.questionType,
    difficulty: version.difficulty,
    questionTextPreview: createQuestionTextPreview(version.questionText),
    tags: [...version.tags],
    author: version.author,
    latestReviewer: version.latestReviewer,
    createdAt: question.createdAt,
    updatedAt: version.updatedAt,
    answerCount: stats.answerCount,
    correctRateBasisPoints: calculateCorrectRateBasisPoints(
      stats.answerCount,
      stats.correctCount
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

export const toCanonicalAdminQuestionList = (
  model: MockAdminCmsReadModel,
  query: ListAdminQuestionsQuery
): ListAdminQuestionsResponse => {
  const matches = model.snapshot.questions
    .map((question) => toQuestionSummary(model, question))
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
  return assertListAdminQuestionsForRequest(query, {
    items,
    page: query.page,
    pageSize: query.pageSize,
    total: matches.length
  })
}

export const toCanonicalAdminQuestionDetail = (
  model: MockAdminCmsReadModel,
  questionId: string
): GetAdminQuestionResponse => {
  const question = findQuestion(model.snapshot, questionId)
  const versions = listQuestionVersions(model.snapshot, questionId)
  const versionIds = new Set(
    versions.map((version) => version.questionVersionId)
  )
  const audits = model.snapshot.auditLogs
    .filter(
      (audit) =>
        (audit.targetType === 'QUESTION' && audit.targetId === questionId) ||
        (audit.targetType === 'QUESTION_VERSION' &&
          versionIds.has(audit.targetId))
    )
    .toSorted(compareOccurredDescending)
  const lastAudit = audits[0]
  const versionItems = versions.slice(0, 20).map(toVersionSummary)
  const contractQuestion = {
    questionId: question.questionId,
    lifecycleStatus: question.lifecycleStatus,
    rowVersion: question.rowVersion,
    currentPublishedVersionId: question.currentPublishedVersionId,
    openCandidateVersionId: question.openCandidateVersionId,
    createdAt: question.createdAt,
    updatedAt: question.updatedAt
  }
  const response = {
    question: contractQuestion,
    versions: {
      questionId,
      items: versionItems,
      nextCursor:
        versions.length > 20 && versionItems.length > 0
          ? encodeAdminQuestionVersionCursor({
              versionNumber: versionItems.at(-1)!.versionNumber,
              id: versionItems.at(-1)!.questionVersionId
            })
          : null
    },
    auditSummary: {
      lastCommand: lastAudit?.command ?? null,
      lastActor: lastAudit?.actor ?? null,
      lastOccurredAt: lastAudit?.occurredAt ?? null,
      totalCount: audits.length
    }
  }
  return assertGetAdminQuestionForRequest({ questionId }, {}, response)
}

export const toCanonicalAdminQuestionVersions = (
  model: MockAdminCmsReadModel,
  questionId: string,
  query: ListAdminQuestionVersionsQuery
): ListAdminQuestionVersionsResponse => {
  findQuestion(model.snapshot, questionId)
  const cursor = query.cursor
    ? decodeAdminQuestionVersionCursor(query.cursor)
    : undefined
  const matches = listQuestionVersions(model.snapshot, questionId).filter(
    (version) =>
      cursor === undefined ||
      version.versionNumber < cursor.versionNumber ||
      (version.versionNumber === cursor.versionNumber &&
        compareUnicodeScalars(version.questionVersionId, cursor.id) < 0)
  )
  const items = matches.slice(0, query.limit).map(toVersionSummary)
  const last = items.at(-1)
  const response = {
    questionId,
    items,
    nextCursor:
      matches.length > query.limit && last
        ? encodeAdminQuestionVersionCursor({
            versionNumber: last.versionNumber,
            id: last.questionVersionId
          })
        : null
  }
  return assertListAdminQuestionVersionsForRequest(
    { questionId },
    query,
    response
  )
}

export const toCanonicalAdminTagList = (
  model: MockAdminCmsReadModel,
  query: ListAdminTagsQuery
): ListAdminTagsResponse => {
  const byNormalizedName = new Map<string, AdminTagSummary>()
  for (const version of model.snapshot.versions) {
    for (const tag of version.tags) {
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
  return assertListAdminTagsForRequest(query, {
    items: [...byNormalizedName.values()]
      .filter((tag) =>
        tag.normalizedName.startsWith(normalizePhase7TagKey(query.q))
      )
      .toSorted(compareAdminTags)
      .slice(0, query.limit)
  })
}

export const toCanonicalAdminQuestionPreview = (
  model: MockAdminCmsReadModel,
  versionId: string
): PreviewQuestionVersionResponse => {
  const version = findVersion(model.snapshot, versionId)
  return assertPreviewQuestionVersionForRequest(
    { versionId },
    {},
    {
      question: {
        id: version.questionId,
        questionVersionId: version.questionVersionId,
        level: version.level,
        subject: version.subject,
        questionType: version.questionType,
        passage: version.passage,
        questionText: version.questionText,
        options: version.options
          .toSorted((left, right) => left.ordinal - right.ordinal)
          .map((option) => ({
            id: option.id,
            label: String(option.ordinal),
            text: option.text
          })),
        difficulty: version.difficulty,
        tags: version.tags
          .map(({ id, label }) => ({ id, label }))
          .toSorted(comparePublicQuestionTags)
      },
      adminAnswer: {
        correctOptionId: version.correctOptionId,
        explanationKo: version.explanationKo,
        explanationJa: version.explanationJa
      }
    }
  )
}

const toDiffOptions = (version: MockPhase7AdminVersion) =>
  version.options
    .toSorted((left, right) => left.ordinal - right.ordinal)
    .map((option) => ({
      ordinal: option.ordinal,
      text: option.text,
      isCorrect: option.id === version.correctOptionId
    }))

export const toCanonicalAdminQuestionDiff = (
  model: MockAdminCmsReadModel,
  versionId: string,
  query: DiffQuestionVersionQuery
): DiffQuestionVersionResponse => {
  const target = findVersion(model.snapshot, versionId)
  const base = model.snapshot.versions.find(
    (candidate) =>
      candidate.questionId === target.questionId &&
      candidate.questionVersionId === query.baseVersionId
  )
  if (!base) {
    throw new MockAdminCmsReadNotFoundError(
      '비교할 문제 버전을 찾을 수 없습니다.'
    )
  }
  const changes: Array<Record<string, unknown>> = []
  const addScalar = (
    field: (typeof phase7DiffFieldOrder)[number],
    before: string | null,
    after: string | null
  ): void => {
    if (before !== after) changes.push({ field, kind: 'SCALAR', before, after })
  }
  addScalar('LEVEL', base.level, target.level)
  addScalar('SUBJECT', base.subject, target.subject)
  addScalar('QUESTION_TYPE', base.questionType, target.questionType)
  addScalar('DIFFICULTY', base.difficulty, target.difficulty)
  addScalar('PASSAGE', base.passage, target.passage)
  addScalar('QUESTION_TEXT', base.questionText, target.questionText)
  addScalar('EXPLANATION_KO', base.explanationKo, target.explanationKo)
  addScalar('EXPLANATION_JA', base.explanationJa, target.explanationJa)
  const beforeOptions = toDiffOptions(base)
  const afterOptions = toDiffOptions(target)
  if (JSON.stringify(beforeOptions) !== JSON.stringify(afterOptions)) {
    changes.push({
      field: 'OPTIONS',
      kind: 'OPTIONS',
      before: beforeOptions,
      after: afterOptions
    })
  }
  if (JSON.stringify(base.tags) !== JSON.stringify(target.tags)) {
    changes.push({
      field: 'TAGS',
      kind: 'TAGS',
      before: base.tags,
      after: target.tags
    })
  }
  return assertDiffQuestionVersionForRequest({ versionId }, query, {
    baseVersionId: base.questionVersionId,
    targetVersionId: target.questionVersionId,
    changedFields: changes.map((change) => change.field),
    changes
  })
}

const compareOccurredDescending = (
  left: { readonly id: string; readonly occurredAt: string },
  right: { readonly id: string; readonly occurredAt: string }
): number =>
  compareUnicodeScalars(right.occurredAt, left.occurredAt) ||
  compareUnicodeScalars(right.id, left.id)

const isAfterOccurredCursor = (
  item: { readonly id: string; readonly occurredAt: string },
  cursor: string | undefined
): boolean => {
  if (!cursor) return true
  const decoded = decodePhase7OccurredAtCursor(cursor)
  return (
    item.occurredAt < decoded.occurredAt ||
    (item.occurredAt === decoded.occurredAt &&
      compareUnicodeScalars(item.id, decoded.id) < 0)
  )
}

const occurredNextCursor = (
  total: number,
  limit: number,
  items: readonly { readonly id: string; readonly occurredAt: string }[]
): string | null => {
  const last = items.at(-1)
  return total > limit && last
    ? encodePhase7OccurredAtCursor({ id: last.id, occurredAt: last.occurredAt })
    : null
}

export const toCanonicalAdminQuestionReviews = (
  model: MockAdminCmsReadModel,
  versionId: string,
  query: ListQuestionVersionReviewsQuery
): ListQuestionVersionReviewsResponse => {
  findVersion(model.snapshot, versionId)
  const matches = model.snapshot.reviews
    .filter(
      (review) =>
        review.questionVersionId === versionId &&
        isAfterOccurredCursor(review, query.cursor)
    )
    .toSorted(compareOccurredDescending)
  const items = matches.slice(0, query.limit)
  return assertListQuestionVersionReviewsForRequest({ versionId }, query, {
    questionVersionId: versionId,
    items,
    nextCursor: occurredNextCursor(matches.length, query.limit, items)
  })
}

export const toCanonicalAdminAuditLog = (
  model: MockAdminCmsReadModel,
  query: ListAdminAuditLogQuery
): ListAdminAuditLogResponse => {
  const matches = model.snapshot.auditLogs
    .filter(
      (item) =>
        (query.command === undefined || item.command === query.command) &&
        (query.targetType === undefined ||
          item.targetType === query.targetType) &&
        (query.targetId === undefined || item.targetId === query.targetId) &&
        (query.actorId === undefined ||
          (item.actor.kind === 'ACCOUNT' &&
            item.actor.actorId === query.actorId)) &&
        (query.environment === undefined ||
          item.environment === query.environment) &&
        isInHalfOpenRange(
          item.occurredAt,
          query.occurredFrom,
          query.occurredTo
        ) &&
        isAfterOccurredCursor(item, query.cursor)
    )
    .toSorted(compareOccurredDescending)
  const items: AdminAuditLogItem[] = matches.slice(0, query.limit)
  return assertListAdminAuditLogForRequest(query, {
    items,
    nextCursor: occurredNextCursor(matches.length, query.limit, items)
  })
}
