import type {
  JlptLevel,
  QuestionDifficulty,
  QuestionSubject,
  QuestionType
} from '@nihongo/contracts/common/enum'

export interface OriginalQuestionSeed {
  id: string
  level: JlptLevel
  subject: QuestionSubject
  questionType: QuestionType
  passage?: string
  questionText: string
  options: readonly [string, string, string, string]
  correctIndex: 0 | 1 | 2 | 3
  explanationKo: string
  explanationJa?: string
  difficulty: QuestionDifficulty
  tags: readonly [string, ...string[]]
}

export const createOriginalQuestion = (
  seed: OriginalQuestionSeed
): OriginalQuestionSeed => seed
