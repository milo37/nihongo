import { mutationOptions } from '@tanstack/react-query'
import { reviewWrongNote } from '@api/wrong-note/reviewWrongNote'
import type { ReviewWrongNoteRequest } from '@api/wrong-note/reviewWrongNote/schema'
import { updateWrongNoteMemo } from '@api/wrong-note/updateWrongNoteMemo'
import type { UpdateWrongNoteMemoRequest } from '@api/wrong-note/updateWrongNoteMemo/schema'
import { serverStateQueryKeys } from '@app/serverStateQueryKeys'
import { isMockApiMode } from '@libs/apiMode'
import { createObjectAuthBoundActionFence } from '@libs/authTransitionFence'

const updateMemoActionFence =
  createObjectAuthBoundActionFence<UpdateWrongNoteMemoRequest>()
const reviewWrongNoteActionFence =
  createObjectAuthBoundActionFence<ReviewWrongNoteRequest>()

export const assertCurrentUpdateWrongNoteMemoAction = (
  input: UpdateWrongNoteMemoRequest
): void => updateMemoActionFence.assertCurrent(input)

export const assertCurrentReviewWrongNoteAction = (
  input: ReviewWrongNoteRequest
): void => reviewWrongNoteActionFence.assertCurrent(input)

export const legacyWrongNoteMutations = {
  updateMemo: (questionId: string) =>
    mutationOptions({
      mutationKey: [
        ...serverStateQueryKeys.wrongNote.all(),
        'update-wrong-note-memo',
        questionId
      ] as const,
      networkMode: 'always',
      onMutate: (input: UpdateWrongNoteMemoRequest) =>
        updateMemoActionFence.capture(input),
      mutationFn: async (input: UpdateWrongNoteMemoRequest) => {
        assertCurrentUpdateWrongNoteMemoAction(input)
        if (!isMockApiMode) {
          throw new Error('메모 수정은 실제 API에서 아직 지원되지 않습니다.')
        }

        const memo = await updateWrongNoteMemo(questionId, input)
        assertCurrentUpdateWrongNoteMemoAction(input)
        return memo
      },
      onSuccess: (_data, input: UpdateWrongNoteMemoRequest) =>
        assertCurrentUpdateWrongNoteMemoAction(input)
    }),
  review: (questionId: string) =>
    mutationOptions({
      mutationKey: [
        ...serverStateQueryKeys.wrongNote.all(),
        'review-wrong-note',
        questionId
      ] as const,
      networkMode: 'always',
      onMutate: (input: ReviewWrongNoteRequest) =>
        reviewWrongNoteActionFence.capture(input),
      mutationFn: async (input: ReviewWrongNoteRequest) => {
        assertCurrentReviewWrongNoteAction(input)
        if (!isMockApiMode) {
          throw new Error('오답 복습은 실제 API에서 아직 지원되지 않습니다.')
        }

        const review = await reviewWrongNote(questionId, input)
        assertCurrentReviewWrongNoteAction(input)
        return review
      },
      onSuccess: (_data, input: ReviewWrongNoteRequest) =>
        assertCurrentReviewWrongNoteAction(input)
    })
} as const
