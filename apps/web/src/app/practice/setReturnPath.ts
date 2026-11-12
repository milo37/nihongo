import type { StudySessionView } from '@app/practice/adapters/studySessionView'

export type SetReturnPath = '/wrong-notes' | '/bookmarks'

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

export const setReturnLabelKey = {
  '/wrong-notes': 'actions.backToWrongNotes',
  '/bookmarks': 'actions.backToBookmarks'
} as const satisfies Record<SetReturnPath, string>
