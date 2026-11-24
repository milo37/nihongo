import type { StudySessionView } from '@app/practice/adapters/studySessionView'

export type SetReturnPath = '/wrong-notes' | '/bookmarks' | '/practice'

/**
 * JLP-856: where a set goes back to. Wrong-note review sets return to the
 * wrong-note list and bookmark sets to the bookmarks; any other set has no
 * list of its own (null).
 */
export const getSetReturnPath = (
  mode: StudySessionView['session']['mode']
): SetReturnPath | null => {
  switch (mode) {
    case 'DAILY_REVIEW':
    case 'WRONG_NOTE':
      return '/wrong-notes'
    case 'BOOKMARK':
      return '/bookmarks'
    default:
      return null
  }
}

/**
 * #1283: a review set leaves the wrong-note list empty when nothing in it
 * was wrong and nothing else waits for review; it goes to the study tab
 * instead (the setup screen, no set started).
 */
export const getReviewSetReturnPath = (
  listPath: SetReturnPath | null,
  isNothingLeft: boolean
): SetReturnPath | null =>
  listPath === '/wrong-notes' && isNothingLeft ? '/practice' : listPath

export const setReturnLabelKey = {
  '/wrong-notes': 'actions.backToWrongNotes',
  '/bookmarks': 'actions.backToBookmarks',
  '/practice': 'actions.goToStudy'
} as const satisfies Record<SetReturnPath, string>
