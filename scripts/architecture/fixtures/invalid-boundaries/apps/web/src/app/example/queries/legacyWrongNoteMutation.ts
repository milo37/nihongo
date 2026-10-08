import { reviewWrongNote as exactReview } from '@api/wrong-note/reviewWrongNote'
import { reviewWrongNote as indexedReview } from '@api/wrong-note/reviewWrongNote/index'
import { updateWrongNoteMemo } from '@/api/wrong-note/updateWrongNoteMemo'
import * as legacyWrongNoteBridge from '@api/wrong-note/legacyBridge'

export const legacyWrongNoteMutations = {
  exactReview,
  indexedReview,
  legacyWrongNoteBridge,
  updateWrongNoteMemo
}
