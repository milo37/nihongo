import { Link, useNavigate } from 'react-router'
import type { ReactElement } from 'react'
import type { JlptLevel, QuestionSubject } from '@common/types/domain'
import { Badge } from '@common/components/Badge'
import { Button } from '@common/components/Button'
import { EmptyState } from '@common/components/EmptyState'
import { ErrorState } from '@common/components/ErrorState'
import { LoadingState } from '@common/components/LoadingState'
import { useDeleteBookmark } from '@app/bookmark/hooks/useDeleteBookmark'
import { useListBookmarks } from '@app/bookmark/hooks/useListBookmarks'
import { useCreateStudySession } from '@app/practice/hooks/useCreateStudySession'
import { assertCurrentCreateStudySessionAction } from '@app/practice/queries/studySessionQueries'
import { useAppStore } from '@store/index'

const subjectLabels = {
  VOCABULARY: '문자·어휘',
  GRAMMAR: '문법',
  READING: '독해'
} as const

interface BookmarkPracticeGroup {
  level: JlptLevel
  subject: QuestionSubject
  questionIds: string[]
}

export const BookmarkPage = (): ReactElement => {
  const navigate = useNavigate()
  const bookmarksQuery = useListBookmarks()
  const deleteBookmark = useDeleteBookmark()
  const createSession = useCreateStudySession()
  const beginPractice = useAppStore((state) => state.beginPractice)
  const setPendingBookmark = useAppStore((state) => state.setPendingBookmark)

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
  for (const { question } of bookmarksQuery.data.items) {
    const groupKey = `${question.level}:${question.subject}`
    const group = groupByScope.get(groupKey)

    if (group) {
      group.questionIds.push(question.id)
    } else {
      groupByScope.set(groupKey, {
        level: question.level,
        subject: question.subject,
        questionIds: [question.id]
      })
    }
  }
  const bookmarkGroups = [...groupByScope.values()]

  const startBookmarkPractice = (questionIds: string[]): void => {
    const requestedId = questionIds[0]
    const firstQuestion = bookmarksQuery.data.items.find(
      (item) => item.question.id === requestedId
    )?.question

    if (!firstQuestion) {
      return
    }

    const targets = questionIds.slice(0, 20)

    createSession.mutate(
      {
        level: firstQuestion.level,
        subject: firstQuestion.subject,
        mode: 'BOOKMARK',
        count: targets.length,
        questionIds: targets
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
    deleteBookmark.mutate(questionId, {
      onSuccess: () => {
        setPendingBookmark(questionId, false)
      }
    })
  }

  return (
    <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
      <div className="flex flex-col gap-5 border-b border-line pb-8 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-black tracking-[0.16em] text-brand">
            BOOKMARKS
          </p>
          <h1 className="mt-2 text-4xl font-black">즐겨찾기 문제</h1>
          <p className="mt-3 text-muted">
            다시 확인하고 싶은 문제를 모아 BOOKMARK 모드로 학습할 수 있습니다.
          </p>
        </div>
      </div>

      {bookmarksQuery.data.items.length === 0 ? (
        <EmptyState
          title="저장한 문제가 없습니다"
          description="문제풀이 화면에서 즐겨찾기를 누르면 이곳에 모아볼 수 있습니다."
          action={
            <Link
              className="font-bold text-brand underline hover:no-underline"
              to="/practice"
            >
              문제 풀러 가기
            </Link>
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
              한 세션은 같은 급수와 과목으로 구성됩니다. 원하는 범위를 선택해
              시작하세요.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              {bookmarkGroups.map((group) => (
                <Button
                  key={`${group.level}:${group.subject}`}
                  variant="outline"
                  isLoading={createSession.isPending}
                  onClick={() => startBookmarkPractice(group.questionIds)}
                >
                  {group.level} · {subjectLabels[group.subject]} ·{' '}
                  {group.questionIds.length}문제 풀기
                </Button>
              ))}
            </div>
          </section>

          <div className="mt-8 grid gap-4 lg:grid-cols-2">
            {bookmarksQuery.data.items.map(({ bookmark, question }) => (
              <article
                key={bookmark.id}
                className="content-auto rounded-xl border border-line bg-white p-5"
              >
                <div className="flex flex-wrap gap-2">
                  <Badge variant="brand">{question.level}</Badge>
                  <Badge>{subjectLabels[question.subject]}</Badge>
                  <Badge>{question.questionType}</Badge>
                </div>
                <h2 className="mt-5 line-clamp-3 text-lg font-black leading-7">
                  {question.questionText}
                </h2>
                <div className="mt-4 flex flex-wrap gap-2">
                  {question.tags.map((tag) => (
                    <Badge key={tag}>{tag}</Badge>
                  ))}
                </div>
                <div className="mt-6 flex flex-wrap gap-2 border-t border-line pt-4">
                  <Button
                    variant="outline"
                    isLoading={createSession.isPending}
                    onClick={() => startBookmarkPractice([question.id])}
                  >
                    이 문제 풀기
                  </Button>
                  <Button
                    variant="ghost"
                    isLoading={deleteBookmark.isPending}
                    onClick={() => removeBookmark(question.id)}
                  >
                    즐겨찾기 해제
                  </Button>
                </div>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  )
}
