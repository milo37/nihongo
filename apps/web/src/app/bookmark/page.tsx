import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import type { ReactElement } from 'react'
import type { JlptLevel, QuestionSubject } from '@common/types/domain'
import { Badge } from '@common/components/Badge'
import { Button } from '@common/components/Button'
import { EmptyState } from '@common/components/EmptyState'
import { ErrorState } from '@common/components/ErrorState'
import { LoadingState } from '@common/components/LoadingState'
import { useBookmarkMutationActivity } from '@app/bookmark/hooks/useBookmarkMutationActivity'
import { useDeleteBookmark } from '@app/bookmark/hooks/useDeleteBookmark'
import { useListBookmarks } from '@app/bookmark/hooks/useListBookmarks'
import { useCreateStudySession } from '@app/practice/hooks/useCreateStudySession'
import { assertCurrentCreateStudySessionAction } from '@app/practice/queries/studySessionQueries'
import { isAuthTransitionSupersededError } from '@libs/authTransitionFence'
import { useAppStore } from '@store/index'
import { isNoEligibleQuestionsApiError } from '@util/apiError'

const PAGE_SIZE = 20

const subjectLabels = {
  VOCABULARY: '문자·어휘',
  GRAMMAR: '문법',
  READING: '독해'
} as const

interface BookmarkPracticeGroup {
  level: JlptLevel
  subject: QuestionSubject
}

export const BookmarkPage = (): ReactElement => {
  const navigate = useNavigate()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const ownerIdentityRef = useRef<string | null | undefined>(undefined)
  const [page, setPage] = useState(1)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const bookmarksQuery = useListBookmarks({ page, pageSize: PAGE_SIZE })
  const bookmarkMutationActivity = useBookmarkMutationActivity()
  const hasPendingBookmarkMutation =
    bookmarkMutationActivity.pendingQuestionIds.size > 0
  const deleteBookmark = useDeleteBookmark()
  const createSession = useCreateStudySession()
  const resetCreateSession = createSession.reset
  const resetDeleteBookmark = deleteBookmark.reset
  const beginPractice = useAppStore((state) => state.beginPractice)
  const currentUserId = useAppStore((state) => state.currentUser?.id ?? null)

  useEffect(() => {
    if (ownerIdentityRef.current === undefined) {
      ownerIdentityRef.current = currentUserId
      return
    }
    if (ownerIdentityRef.current === currentUserId) return
    ownerIdentityRef.current = currentUserId
    setPage(1)
    setStatusMessage(null)
    resetCreateSession()
    resetDeleteBookmark()
  }, [currentUserId, resetCreateSession, resetDeleteBookmark])

  const pageCount = bookmarksQuery.data
    ? Math.max(1, Math.ceil(bookmarksQuery.data.total / PAGE_SIZE))
    : page
  const noEligibleQuestions =
    createSession.isError && isNoEligibleQuestionsApiError(createSession.error)
  const hasCreateSessionError =
    createSession.isError &&
    !noEligibleQuestions &&
    !isAuthTransitionSupersededError(createSession.error)

  useEffect(() => {
    if (!bookmarksQuery.data || bookmarksQuery.data.page !== page) return
    if (bookmarkMutationActivity.pendingQuestionIds.size > 0) return
    if (bookmarksQuery.isFetching || bookmarksQuery.isStale) return
    if (page <= pageCount) return
    const timerId = window.setTimeout(() => setPage(pageCount), 0)
    return () => window.clearTimeout(timerId)
  }, [
    bookmarkMutationActivity.pendingQuestionIds.size,
    bookmarksQuery.data,
    bookmarksQuery.isFetching,
    bookmarksQuery.isStale,
    page,
    pageCount
  ])

  if (bookmarksQuery.isPending) {
    return <LoadingState message="즐겨찾기를 불러오고 있습니다." />
  }

  if (bookmarksQuery.isError || !bookmarksQuery.data) {
    return (
      <ErrorState
        headingLevel={1}
        title="즐겨찾기를 불러오지 못했습니다"
        description="잠시 후 다시 요청해 주세요."
        action={
          <Button onClick={() => void bookmarksQuery.refetch()}>
            다시 시도
          </Button>
        }
      />
    )
  }

  const groupByScope = new Map<string, BookmarkPracticeGroup>()
  for (const bookmark of bookmarksQuery.data.items) {
    if (bookmark.availability !== 'AVAILABLE') continue
    const { question } = bookmark
    const groupKey = `${question.level}:${question.subject}`
    const group = groupByScope.get(groupKey)
    if (!group) {
      groupByScope.set(groupKey, {
        level: question.level,
        subject: question.subject
      })
    }
  }
  const bookmarkGroups = [...groupByScope.values()]

  const startBookmarkPractice = (group: BookmarkPracticeGroup): void => {
    createSession.reset()
    createSession.mutate(
      {
        level: group.level,
        subject: group.subject,
        mode: 'BOOKMARK',
        count: 20
      },
      {
        onSuccess: ({ session }, input) => {
          assertCurrentCreateStudySessionAction(input)
          beginPractice(session.id, session.startedAt)
          void navigate(`/practice/session/${session.id}`)
        }
      }
    )
  }

  const removeBookmark = (questionId: string): void => {
    setStatusMessage('즐겨찾기 해제를 처리하고 있습니다.')
    deleteBookmark.mutate(questionId, {
      onSuccess: () => {
        setStatusMessage('즐겨찾기에서 해제했습니다.')
        headingRef.current?.focus()
      },
      onError: (error) => {
        if (isAuthTransitionSupersededError(error)) return
        setStatusMessage(
          '즐겨찾기 해제를 완료하지 못해 이전 상태로 복원했습니다.'
        )
      }
    })
  }

  const mutationStatus = bookmarkMutationActivity.isPaused
    ? '오프라인입니다. 연결되면 즐겨찾기 변경을 다시 시도합니다.'
    : statusMessage

  return (
    <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
      <div className="flex flex-col gap-5 border-b border-line pb-8 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-black tracking-[0.16em] text-brand">
            BOOKMARKS
          </p>
          <h1
            ref={headingRef}
            className="mt-2 text-4xl font-black focus:outline-none"
            tabIndex={-1}
          >
            즐겨찾기 문제
          </h1>
          <p className="mt-3 text-muted">
            다시 확인하고 싶은 문제를 모아 BOOKMARK 모드로 학습할 수 있습니다.
          </p>
        </div>
      </div>

      {mutationStatus ? (
        <p
          className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900"
          role="status"
          aria-live="polite"
        >
          {mutationStatus}
        </p>
      ) : null}

      {bookmarksQuery.data.items.length === 0 ? (
        <EmptyState
          title={
            page === 1 ? '저장한 문제가 없습니다' : '이 페이지가 비었습니다'
          }
          description={
            page === 1
              ? '문제풀이 화면에서 즐겨찾기를 누르면 이곳에 모아볼 수 있습니다.'
              : '이전 페이지에서 즐겨찾기를 확인해 주세요.'
          }
          action={
            page === 1 ? (
              <Link
                className="font-bold text-brand underline hover:no-underline"
                to="/practice"
              >
                문제 풀러 가기
              </Link>
            ) : (
              <Button onClick={() => setPage((current) => current - 1)}>
                이전 페이지
              </Button>
            )
          }
        />
      ) : (
        <>
          <section
            className="mt-8 rounded-xl border border-line bg-white p-5"
            aria-labelledby="bookmark-practice-groups"
          >
            <h2 id="bookmark-practice-groups" className="text-xl font-black">
              범위별 즐겨찾기 재풀이
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted">
              같은 급수와 과목의 현재 공개 문제를 저장 순서대로 출제합니다.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              {bookmarkGroups.map((group) => (
                <Button
                  key={`${group.level}:${group.subject}`}
                  variant="outline"
                  isLoading={createSession.isPending || createSession.isPaused}
                  onClick={() => startBookmarkPractice(group)}
                >
                  {group.level} · {subjectLabels[group.subject]} · 최대 20문제
                  풀기
                </Button>
              ))}
            </div>
            {bookmarkGroups.length === 0 ? (
              <p
                className="mt-5 text-sm font-bold text-amber-800"
                role="status"
              >
                이 페이지의 즐겨찾기는 모두 보관되어 현재 출제할 수 없습니다.
              </p>
            ) : null}
            {noEligibleQuestions ? (
              <div
                className="mt-5 rounded-lg border border-amber-300 bg-amber-50 p-4"
                role="alert"
              >
                <p className="font-bold text-amber-900">
                  선택한 범위에 현재 출제 가능한 즐겨찾기 문제가 없습니다.
                </p>
                <Button
                  className="mt-3"
                  variant="outline"
                  onClick={() => {
                    createSession.reset()
                    void bookmarksQuery.refetch()
                  }}
                >
                  즐겨찾기 목록 새로고침
                </Button>
              </div>
            ) : null}
            {hasCreateSessionError ? (
              <div
                className="mt-5 rounded-lg border border-red-200 bg-red-50 p-4"
                role="alert"
              >
                <p className="font-bold text-red-800">
                  BOOKMARK 학습을 시작하지 못했습니다. 잠시 후 다시 시도해
                  주세요.
                </p>
                <Button
                  className="mt-3"
                  variant="outline"
                  onClick={() => {
                    const input = createSession.variables
                    if (input?.mode !== 'BOOKMARK') {
                      createSession.reset()
                      return
                    }
                    startBookmarkPractice({
                      level: input.level,
                      subject: input.subject
                    })
                  }}
                >
                  다시 시도
                </Button>
              </div>
            ) : null}
          </section>

          <div className="mt-8 grid gap-4 lg:grid-cols-2">
            {bookmarksQuery.data.items.map((bookmark) => {
              const { question } = bookmark
              const isDeleting =
                bookmarkMutationActivity.pendingQuestionIds.has(
                  bookmark.questionId
                )
              return (
                <article
                  key={bookmark.questionId}
                  className="content-auto rounded-xl border border-line bg-white p-5"
                >
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="brand">{question.level}</Badge>
                    <Badge>{subjectLabels[question.subject]}</Badge>
                    <Badge>{question.questionType}</Badge>
                    <Badge
                      variant={
                        bookmark.availability === 'AVAILABLE'
                          ? 'success'
                          : 'warning'
                      }
                    >
                      {bookmark.availability === 'AVAILABLE'
                        ? '출제 가능'
                        : '보관된 문제'}
                    </Badge>
                  </div>
                  <h2 className="mt-5 line-clamp-3 text-lg font-black leading-7">
                    {question.questionTextPreview}
                  </h2>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {question.tags.map((tag) => (
                      <Badge key={tag.id}>{tag.label}</Badge>
                    ))}
                  </div>
                  {bookmark.availability === 'ARCHIVED' ? (
                    <p className="mt-4 text-sm font-bold text-amber-800">
                      공개가 종료되어 새 학습 세션에는 포함되지 않습니다.
                    </p>
                  ) : null}
                  <div className="mt-6 border-t border-line pt-4">
                    <Button
                      variant="ghost"
                      disabled={hasPendingBookmarkMutation}
                      isLoading={isDeleting}
                      onClick={() => removeBookmark(bookmark.questionId)}
                    >
                      즐겨찾기 해제
                    </Button>
                  </div>
                </article>
              )
            })}
          </div>

          <nav
            className="mt-8 flex items-center justify-center gap-3"
            aria-label="즐겨찾기 페이지"
          >
            <Button
              variant="outline"
              disabled={page <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              이전
            </Button>
            <span className="text-sm font-bold" aria-live="polite">
              {page} / {pageCount} 페이지
            </span>
            <Button
              variant="outline"
              disabled={page >= pageCount}
              onClick={() => setPage((current) => current + 1)}
            >
              다음
            </Button>
          </nav>
        </>
      )}
    </section>
  )
}
