import type {
  JlptLevel,
  QuestionSubject,
  StudyMode
} from '@nihongo/browser/common/types/domain'

// Practice setup choices and the URL parsers that fall back to their defaults.
export const levels: JlptLevel[] = ['N5', 'N4', 'N3', 'N2', 'N1']
export const subjects: QuestionSubject[] = ['VOCABULARY', 'GRAMMAR', 'READING']
export const counts = [5, 10, 20] as const
// One list; for guests every mode but RANDOM is locked (U4 L11, L17).
export const modes: readonly StudyMode[] = [
  'RANDOM',
  'WEAKNESS',
  'WRONG_NOTE',
  'BOOKMARK',
  'DAILY_REVIEW'
]

/** Level when the URL names none and the learner has no target level. */
export const FALLBACK_LEVEL: JlptLevel = 'N5'
export const DEFAULT_SUBJECT: QuestionSubject = 'VOCABULARY'
export const DEFAULT_COUNT = 10

/** The URL level, else the default (the learner's target level or N5). */
export const getInitialLevel = (
  value: string | null,
  defaultLevel: JlptLevel = FALLBACK_LEVEL
): JlptLevel => {
  return levels.includes(value as JlptLevel)
    ? (value as JlptLevel)
    : defaultLevel
}

export const getInitialSubject = (value: string | null): QuestionSubject => {
  return subjects.includes(value as QuestionSubject)
    ? (value as QuestionSubject)
    : DEFAULT_SUBJECT
}

export const getInitialCount = (value: string | null): 5 | 10 | 20 => {
  const numberValue = Number(value)
  return counts.includes(numberValue as 5 | 10 | 20)
    ? (numberValue as 5 | 10 | 20)
    : DEFAULT_COUNT
}

export const getRequestedMode = (value: string | null): StudyMode => {
  return modes.find((item) => item === value) ?? 'RANDOM'
}

export const getResumablePage = (value: string | null): number => {
  const page = Number(value)
  return Number.isSafeInteger(page) && page > 0 ? page : 1
}
