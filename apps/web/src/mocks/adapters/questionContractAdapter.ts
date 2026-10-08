import {
  comparePublicQuestionTags,
  normalizeQuestionTagText,
  type GetQuestionResponse
} from '@nihongo/contracts/question/get-question'
import type { PublicQuestionSummary } from '@nihongo/contracts/question/list-questions'
import type { PracticeQuestion, QuestionRecord } from '@common/types/domain'

const PHASE_7_CONTRACT_IDENTITY = '__phase7ContractIdentity' as const

export interface Phase7QuestionContractIdentity {
  readonly optionIdBySourceId: Readonly<Record<string, string>>
  readonly questionId: string
  readonly questionVersionId: string
  readonly tagIdByNormalizedLabel: Readonly<Record<string, string>>
}

export type Phase7ProjectedQuestionRecord = QuestionRecord & {
  readonly [PHASE_7_CONTRACT_IDENTITY]: Phase7QuestionContractIdentity
}

export const getPhase7QuestionContractIdentity = (
  question: unknown
): Phase7QuestionContractIdentity | null => {
  if (typeof question !== 'object' || question === null) return null
  const identity = (question as Record<string, unknown>)[
    PHASE_7_CONTRACT_IDENTITY
  ]
  if (typeof identity !== 'object' || identity === null) return null
  const candidate = identity as Record<string, unknown>
  if (
    typeof candidate.questionId !== 'string' ||
    typeof candidate.questionVersionId !== 'string' ||
    typeof candidate.optionIdBySourceId !== 'object' ||
    candidate.optionIdBySourceId === null ||
    typeof candidate.tagIdByNormalizedLabel !== 'object' ||
    candidate.tagIdByNormalizedLabel === null
  ) {
    return null
  }
  return identity as Phase7QuestionContractIdentity
}

export const withPhase7QuestionContractIdentity = (
  question: QuestionRecord,
  identity: Phase7QuestionContractIdentity
): Phase7ProjectedQuestionRecord => ({
  ...question,
  [PHASE_7_CONTRACT_IDENTITY]: identity
})

const FNV_OFFSET_BASIS = 0xcbf29ce484222325n
const FNV_PRIME = 0x100000001b3n
const UINT64_MASK = 0xffffffffffffffffn

const hash64 = (value: string): string => {
  let hash = FNV_OFFSET_BASIS

  for (const character of value) {
    hash ^= BigInt(character.codePointAt(0) ?? 0)
    hash = (hash * FNV_PRIME) & UINT64_MASK
  }

  return hash.toString(16).padStart(16, '0')
}

export const toStableMockUuid = (namespace: string, value: string): string => {
  const hexadecimal = `${hash64(`${namespace}:${value}`)}${hash64(
    `${value}:${namespace}`
  )}`

  return [
    hexadecimal.slice(0, 8),
    hexadecimal.slice(8, 12),
    `4${hexadecimal.slice(13, 16)}`,
    `8${hexadecimal.slice(17, 20)}`,
    hexadecimal.slice(20, 32)
  ].join('-')
}

export const getContractQuestionId = (sourceQuestionId: string): string =>
  toStableMockUuid('question', sourceQuestionId)

export const getCanonicalQuestionId = (
  question: Pick<QuestionRecord, 'id'>
): string =>
  getPhase7QuestionContractIdentity(question)?.questionId ??
  getContractQuestionId(question.id)

export const getSourceQuestionId = (
  contractQuestionId: string,
  questions: readonly Pick<QuestionRecord, 'id'>[]
): string | undefined =>
  questions.find(
    (question) => getContractQuestionId(question.id) === contractQuestionId
  )?.id

export const getQuestionVersionFingerprint = (
  question: QuestionRecord
): string =>
  JSON.stringify({
    updatedAt: question.updatedAt,
    level: question.level,
    subject: question.subject,
    questionType: question.questionType,
    passage: question.passage,
    questionText: question.questionText,
    options: question.options,
    explanationKo: question.explanationKo,
    explanationJa: question.explanationJa,
    difficulty: question.difficulty,
    tags: question.tags,
    status: question.status
  })

export const toContractPracticeQuestion = (
  question: PracticeQuestion,
  versionFingerprint = '1',
  identity = getPhase7QuestionContractIdentity(question)
): GetQuestionResponse => ({
  id: identity?.questionId ?? getContractQuestionId(question.id),
  questionVersionId:
    identity?.questionVersionId ??
    toStableMockUuid(
      'question-version',
      `${question.id}:${versionFingerprint}`
    ),
  level: question.level,
  subject: question.subject,
  questionType: question.questionType,
  passage: question.passage,
  questionText: question.questionText,
  options: question.options.map(({ id, label, text }) => ({
    id:
      identity?.optionIdBySourceId[id] ??
      toStableMockUuid('question-option', `${id}:${versionFingerprint}`),
    label,
    text
  })),
  difficulty: question.difficulty,
  tags: question.tags
    .map((label) => ({
      id:
        identity?.tagIdByNormalizedLabel[normalizeQuestionTagText(label)] ??
        toStableMockUuid('question-tag', normalizeQuestionTagText(label)),
      label
    }))
    .toSorted(comparePublicQuestionTags)
})
export const toContractQuestionSummary = (
  question: QuestionRecord
): PublicQuestionSummary => {
  const identity = getPhase7QuestionContractIdentity(question)
  const detail = toContractPracticeQuestion(
    question,
    getQuestionVersionFingerprint(question),
    identity
  )
  const characters = [...detail.questionText]

  return {
    id: detail.id,
    questionVersionId: detail.questionVersionId,
    level: detail.level,
    subject: detail.subject,
    questionType: detail.questionType,
    difficulty: detail.difficulty,
    questionTextPreview:
      characters.length <= 160
        ? detail.questionText
        : `${characters.slice(0, 157).join('')}...`,
    tags: detail.tags
  }
}
