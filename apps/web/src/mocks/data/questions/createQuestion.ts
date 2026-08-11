import {
  OPTION_LABELS,
  type JlptLevel,
  type QuestionDifficulty,
  type QuestionRecord,
  type QuestionSubject,
  type QuestionType
} from '@common/types/domain'

const SEED_CREATED_AT = '2026-01-01T00:00:00.000Z'

export interface OriginalQuestionSeed {
  id: string
  level: JlptLevel
  subject: QuestionSubject
  questionType: QuestionType
  passage?: string
  questionText: string
  options: [string, string, string, string]
  correctIndex: 0 | 1 | 2 | 3
  explanationKo: string
  explanationJa?: string
  difficulty: QuestionDifficulty
  tags: [string, ...string[]]
}

export const createOriginalQuestion = (
  seed: OriginalQuestionSeed
): QuestionRecord => {
  return {
    id: seed.id,
    level: seed.level,
    subject: seed.subject,
    questionType: seed.questionType,
    passage: seed.passage ?? null,
    questionText: seed.questionText,
    options: seed.options.map((text, index) => ({
      id: `${seed.id}-option-${index + 1}`,
      label: OPTION_LABELS[index],
      text,
      isCorrect: index === seed.correctIndex
    })),
    explanationKo: seed.explanationKo,
    explanationJa: seed.explanationJa ?? null,
    difficulty: seed.difficulty,
    tags: [...seed.tags],
    status: 'PUBLISHED',
    sourceType: 'ORIGINAL',
    createdAt: SEED_CREATED_AT,
    updatedAt: SEED_CREATED_AT
  }
}
