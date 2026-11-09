import type {
  JlptLevel,
  QuestionSubject,
  StudyMode
} from '@nihongo/browser/common/types/domain'

// Practice setup choices and the URL parsers that fall back to their defaults.
export const levels: JlptLevel[] = ['N5', 'N4', 'N3', 'N2', 'N1']
export const subjects: QuestionSubject[] = ['VOCABULARY', 'GRAMMAR', 'READING']
// Random or the wrong answers due for review (subtract table 3). Bookmarks
// start from the bookmark screen. For guests DAILY_REVIEW is locked.
export const modes: readonly StudyMode[] = ['RANDOM', 'DAILY_REVIEW']

/** Level when the URL names none and there is no target or last level. */
export const FALLBACK_LEVEL: JlptLevel = 'N5'
export const FALLBACK_SUBJECT: QuestionSubject = 'VOCABULARY'
/** A member always gets one set of 10 (subtract table 4). */
export const MEMBER_COUNT = 10

/** The URL level, else the default (target level, last level or N5). */
export const getInitialLevel = (
  value: string | null,
  defaultLevel: JlptLevel = FALLBACK_LEVEL
): JlptLevel => {
  return levels.includes(value as JlptLevel)
    ? (value as JlptLevel)
    : defaultLevel
}

export const getInitialSubject = (
  value: string | null,
  defaultSubject: QuestionSubject = FALLBACK_SUBJECT
): QuestionSubject => {
  return subjects.includes(value as QuestionSubject)
    ? (value as QuestionSubject)
    : defaultSubject
}

export const getRequestedMode = (value: string | null): StudyMode => {
  return modes.find((item) => item === value) ?? 'RANDOM'
}
