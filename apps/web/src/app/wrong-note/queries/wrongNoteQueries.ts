import { mutationOptions, queryOptions } from '@tanstack/react-query'
import { getWrongNote } from '@api/wrong-note/getWrongNote'
import { getWrongNoteV1 } from '@api/wrong-note/getWrongNoteV1'
import { listWrongNote } from '@api/wrong-note/listWrongNote'
import type { ListWrongNoteRequest } from '@api/wrong-note/listWrongNote/schema'
import { listWrongNotesV1 } from '@api/wrong-note/listWrongNotesV1'
import { reviewWrongNote } from '@api/wrong-note/reviewWrongNote'
import type { ReviewWrongNoteRequest } from '@api/wrong-note/reviewWrongNote/schema'
import { updateWrongNoteMemo } from '@api/wrong-note/updateWrongNoteMemo'
import type { UpdateWrongNoteMemoRequest } from '@api/wrong-note/updateWrongNoteMemo/schema'
import {
  toCanonicalWrongNoteDetailView,
  toCanonicalWrongNoteListView,
  toLegacyWrongNoteDetailView,
  toLegacyWrongNoteListView
} from '@app/wrong-note/adapters/wrongNoteView'
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

const listWrongNotes = async (params: ListWrongNoteRequest) => {
  if (isMockApiMode) {
    return toLegacyWrongNoteListView(await listWrongNote(params))
  }

  return toCanonicalWrongNoteListView(await listWrongNotesV1(params))
}

const getWrongNoteDetail = async (questionId: string) => {
  if (isMockApiMode) {
    return toLegacyWrongNoteDetailView(await getWrongNote(questionId))
  }

  return toCanonicalWrongNoteDetailView(await getWrongNoteV1(questionId))
}

export const wrongNoteQueries = {
  allKey: serverStateQueryKeys.wrongNote.all,
  list: (params: ListWrongNoteRequest) =>
    queryOptions({
      queryKey: [
        ...wrongNoteQueries.allKey(),
        'list-wrong-notes',
        params
      ] as const,
      queryFn: () => listWrongNotes(params),
      staleTime: 15_000
    }),
  detail: (questionId: string) =>
    queryOptions({
      queryKey: [
        ...wrongNoteQueries.allKey(),
        'get-wrong-note',
        questionId
      ] as const,
      queryFn: () => getWrongNoteDetail(questionId),
      enabled: questionId.length > 0
    })
} as const

export const wrongNoteMutations = {
  updateMemo: (questionId: string) =>
    mutationOptions({
      mutationKey: [
        ...wrongNoteQueries.allKey(),
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
        ...wrongNoteQueries.allKey(),
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
