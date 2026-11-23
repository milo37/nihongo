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
/** Set sizes a member can pick on the learn screen (default ten). */
export const MEMBER_COUNT_CHOICES: readonly number[] = [5, 10, 20]
/** #1244: reading passages are long, so a reading set is 5 or 10 (default 5). */
export const READING_COUNT = 5
export const READING_COUNT_CHOICES: readonly number[] = [5, 10]

export const getMemberCountChoices = (
  subject: QuestionSubject
): readonly number[] =>
  subject === 'READING' ? READING_COUNT_CHOICES : MEMBER_COUNT_CHOICES

export const getDefaultMemberCount = (subject: QuestionSubject): number =>
  subject === 'READING' ? READING_COUNT : MEMBER_COUNT

/** A size that is not offered for the subject: an old reading 20 becomes 10. */
export const fitMemberCount = (
  subject: QuestionSubject,
  count: number
): number => {
  const choices = getMemberCountChoices(subject)
  if (choices.includes(count)) return count
  const largest = Math.max(...choices)
  return count > largest ? largest : getDefaultMemberCount(subject)
}

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
