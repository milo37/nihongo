import type { OriginalQuestionSeed } from './questions/createQuestion.js'

export const SEED_TIMESTAMP = new Date('2026-01-01T00:00:00.000Z')

export interface SeedOption {
  id: string
  label: '1' | '2' | '3' | '4'
  ordinal: number
  text: string
}

export interface SeedTag {
  id: string
  label: string
  normalizedName: string
  versionTagId: string
}

export interface QuestionAggregateSeed {
  legacyId: string
  questionId: string
  versionId: string
  versionFingerprint: string
  level: OriginalQuestionSeed['level']
  subject: OriginalQuestionSeed['subject']
  questionType: OriginalQuestionSeed['questionType']
  passage: string | null
  questionText: string
  correctOptionId: string
  explanationKo: string
  explanationJa: string | null
  difficulty: OriginalQuestionSeed['difficulty']
  options: readonly SeedOption[]
  tags: readonly SeedTag[]
}

const normalizeTagName = (label: string): string =>
  label.normalize('NFKC').trim().replaceAll(/\s+/g, ' ').toLocaleLowerCase()

const createVersionFingerprint = (seed: OriginalQuestionSeed): string =>
  JSON.stringify({
    updatedAt: SEED_TIMESTAMP.toISOString(),
    level: seed.level,
    subject: seed.subject,
    questionType: seed.questionType,
    passage: seed.passage ?? null,
    questionText: seed.questionText,
    options: seed.options.map((text, index) => ({
      id: `${seed.id}-option-${index + 1}`,
      label: String(index + 1),
      text,
      isCorrect: index === seed.correctIndex
    })),
    explanationKo: seed.explanationKo,
    explanationJa: seed.explanationJa ?? null,
    difficulty: seed.difficulty,
    tags: [...seed.tags],
    status: 'PUBLISHED'
  })

export const buildQuestionAggregateSeed = (
  seed: OriginalQuestionSeed,
  toUuid: (namespace: string, value: string) => string
): QuestionAggregateSeed => {
  const versionFingerprint = createVersionFingerprint(seed)
  const questionId = toUuid('question', seed.id)
  const versionId = toUuid(
    'question-version',
    `${seed.id}:${versionFingerprint}`
  )
  const options = seed.options.map((text, index) => ({
    id: toUuid(
      'question-option',
      `${seed.id}-option-${index + 1}:${versionFingerprint}`
    ),
    label: String(index + 1) as SeedOption['label'],
    ordinal: index + 1,
    text
  }))
  const tags = seed.tags.map((label) => {
    const normalizedName = normalizeTagName(label)
    const id = toUuid('question-tag', normalizedName)

    return {
      id,
      label,
      normalizedName,
      versionTagId: toUuid('question-version-tag', `${versionId}:${id}`)
    }
  })

  return {
    legacyId: seed.id,
    questionId,
    versionId,
    versionFingerprint,
    level: seed.level,
    subject: seed.subject,
    questionType: seed.questionType,
    passage: seed.passage ?? null,
    questionText: seed.questionText,
    correctOptionId: options[seed.correctIndex]!.id,
    explanationKo: seed.explanationKo,
    explanationJa: seed.explanationJa ?? null,
    difficulty: seed.difficulty,
    options,
    tags
  }
}
