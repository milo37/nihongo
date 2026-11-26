import { describe, expect, it } from 'vitest'
import { subscribeApiError } from '@nihongo/browser/libs/errorBus'
import { queryClient } from '@nihongo/browser/libs/queryClient'
import { authQueries } from '@nihongo/browser/app/login/queries/authQueries'
import { bookmarkQueries } from '@app/bookmark/queries/bookmarkQueries'
import { dashboardQueries } from '@app/dashboard/queries/dashboardQueries'
import { studyDraftMutations } from '@app/practice/queries/studyDraftQueries'
import { studyDraftQueries } from '@app/practice/queries/studyDraftQueries'
import { studyResultQueries } from '@app/practice/queries/studyResultQueries'
import { studyResultRetryMutations } from '@app/practice/queries/studyResultRetryQueries'
import {
  studySessionMutations,
  studySessionQueries
} from '@app/practice/queries/studySessionQueries'
import { reportMutations } from '@app/question-report/queries/reportMutations'
import { wrongNoteMutations } from '@app/wrong-note/queries/wrongNoteMutations'
import { wrongNoteQueries } from '@app/wrong-note/queries/wrongNoteQueries'

// #1262: one failure shows in one place. The screens draw their own failure
// (their own tests check the text); these check nothing reaches the global
// warning toast as well.
const failure = (flags: Record<string, unknown>): Error =>
  Object.assign(new Error('failed'), flags)
const serverError = () => failure({ isServerError: true, status: 500 })

const busErrors = async (run: () => Promise<unknown>): Promise<unknown[]> => {
  const errors: unknown[] = []
  const unsubscribe = subscribeApiError((error) => errors.push(error))
  try {
    await run()
  } catch {
    // The failure itself is expected.
  } finally {
    unsubscribe()
  }
  return errors
}

const fetchFailing = (
  options: { queryKey: readonly unknown[] },
  error: Error
): Promise<unknown> =>
  queryClient.fetchQuery({
    ...options,
    queryFn: () => Promise.reject(error),
    retry: false
  })

const sessionId = '11111111-1111-4111-8111-111111111111'

describe('a failed screen query stays on its screen (#1262 ③)', () => {
  it.each([
    ['문제 화면 책갈피', bookmarkQueries.list()],
    ['문제 화면 세션', studySessionQueries.session(sessionId)],
    ['문제 화면 임시 저장', studyDraftQueries.draft(sessionId)],
    [
      '학습 탭 이어 풀기',
      studyDraftQueries.resumable({
        page: 1,
        pageSize: 3,
        status: 'IN_PROGRESS'
      })
    ],
    ['결과', studyResultQueries.result(sessionId)],
    ['오답노트 목록', wrongNoteQueries.reviewList({})],
    ['오답노트 상세', wrongNoteQueries.detail(sessionId)],
    ['대시보드', dashboardQueries.stats()],
    ['로그인 상태', authQueries.currentUser()]
  ])('%s: 5xx는 전역으로 가지 않는다', async (_name, options) => {
    expect(await busErrors(() => fetchFailing(options, serverError()))).toEqual(
      []
    )
  })

  it('로그인 만료와 권한 없음은 여전히 전역이 받는다(/login, /forbidden)', async () => {
    const expired = failure({ isAuthError: true, status: 401 })
    const forbidden = failure({ isForbiddenError: true, status: 403 })
    expect(
      await busErrors(() => fetchFailing(bookmarkQueries.list(), expired))
    ).toEqual([expired])
    expect(
      await busErrors(() => fetchFailing(bookmarkQueries.list(), forbidden))
    ).toEqual([forbidden])
  })
})

describe('an action that shows its own failure keeps it (#1262 ④)', () => {
  it.each([
    ['답 임시 저장', studyDraftMutations.save(sessionId)],
    ['세트 취소', studyDraftMutations.cancel()],
    ['세트 만들기', studySessionMutations.createSession()],
    ['오답 다시 풀기', studyResultRetryMutations.create()],
    ['골라 복습', wrongNoteMutations.createTargetedReview()],
    ['문제 신고', reportMutations.create()]
  ])('%s: 실패가 전역으로 가지 않는다', async (_name, options) => {
    expect(options.meta?.localErrorUi).toBe(true)
    const mutation = queryClient.getMutationCache().build(queryClient, {
      mutationKey: options.mutationKey,
      meta: options.meta,
      mutationFn: () => Promise.reject(serverError())
    })
    expect(await busErrors(() => mutation.execute(undefined))).toEqual([])
  })
})
