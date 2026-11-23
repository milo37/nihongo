import type { QuestionSubject } from '../common/enum.js'

/**
 * #1244: the set sizes a member picks on the study tab, per subject. Reading
 * passages are long, so a reading set is 5 or 10 (default 5); vocabulary and
 * grammar are 5, 10 or 20 (default 10). The web choices and the server limit
 * for new random sets both read these numbers.
 */
export const MEMBER_COUNT_CHOICES: Readonly<
  Record<QuestionSubject, readonly number[]>
> = {
  VOCABULARY: [5, 10, 20],
  GRAMMAR: [5, 10, 20],
  READING: [5, 10]
}

export const MEMBER_DEFAULT_COUNT: Readonly<Record<QuestionSubject, number>> = {
  VOCABULARY: 10,
  GRAMMAR: 10,
  READING: 5
}

export const getMemberCountChoices = (
  subject: QuestionSubject
): readonly number[] => MEMBER_COUNT_CHOICES[subject]

export const getDefaultMemberCount = (subject: QuestionSubject): number =>
  MEMBER_DEFAULT_COUNT[subject]

/** The largest set a member may start at random for the subject. */
export const getMemberCountLimit = (subject: QuestionSubject): number =>
  Math.max(...MEMBER_COUNT_CHOICES[subject])
