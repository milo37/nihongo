import { Link } from 'react-router'
import type { ReactElement } from 'react'
import type { DashboardView } from '@app/dashboard/adapters/dashboardView'
import { Badge } from '@common/components/Badge'
import { EmptyState } from '@common/components/EmptyState'

const subjectLabels = {
  VOCABULARY: '문자·어휘',
  GRAMMAR: '문법',
  READING: '독해'
} as const

const dateTimeFormatter = new Intl.DateTimeFormat('ko-KR', {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit'
})
const dailyDateFormatter = new Intl.DateTimeFormat('ko-KR', {
  month: 'numeric',
  day: 'numeric',
  timeZone: 'UTC'
})

const formatDate = (value: string): string =>
  dateTimeFormatter.format(new Date(value))

const formatDailyDate = (value: string): string =>
  dailyDateFormatter.format(new Date(`${value}T00:00:00.000Z`))

type DashboardSummarySectionProps = {
  stats: DashboardView
}

export const DashboardSummarySection = ({
  stats
}: DashboardSummarySectionProps): ReactElement => {
  if (stats.totalAnsweredCount === 0) {
    return (
      <EmptyState
        title="아직 학습 기록이 없습니다"
        description="첫 문제를 풀면 정답률, 약한 과목, 최근 7일 학습량이 이곳에 표시됩니다."
        action={
          <Link
            className="inline-flex min-h-11 items-center px-1 font-bold text-brand underline hover:no-underline"
            to="/practice"
          >
            첫 학습 시작하기
          </Link>
        }
      />
    )
  }

  const maxDailyCount = stats.dailyStudyCountLast7Days.reduce(
    (maximum, day) => Math.max(maximum, day.count),
    1
  )

  return (
    <>
      <dl className="mt-8 grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-5">
        <div className="bg-white p-5">
          <dt className="text-sm text-muted">전체 풀이</dt>
          <dd className="mt-2 text-3xl font-black">
            {stats.totalAnsweredCount}
            <span className="ml-1 text-base font-semibold text-muted">
              문제
            </span>
          </dd>
        </div>
        <div className="bg-white p-5">
          <dt className="text-sm text-muted">전체 정답률</dt>
          <dd className="mt-2 text-3xl font-black text-brand">
            {stats.correctRate}%
          </dd>
        </div>
        <div className="bg-white p-5">
          <dt className="text-sm text-muted">누적 오답</dt>
          <dd className="mt-2 text-3xl font-black">
            {stats.wrongNoteCount}
            <span className="ml-1 text-base font-semibold text-muted">개</span>
          </dd>
        </div>
        <div className="bg-white p-5">
          <dt className="text-sm text-muted">해결한 오답</dt>
          <dd className="mt-2 text-3xl font-black">
            {stats.solvedWrongNoteCount}
            <span className="ml-1 text-base font-semibold text-muted">개</span>
          </dd>
        </div>
        <div className="bg-white p-5">
          <dt className="text-sm text-muted">가장 약한 과목</dt>
          <dd className="mt-2 text-xl font-black">
            {stats.weakestSubject
              ? subjectLabels[stats.weakestSubject]
              : '분석 대기'}
          </dd>
        </div>
      </dl>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <article className="rounded-xl border border-line bg-white p-5 sm:p-7">
          <h2 className="text-xl font-black">과목별 정답률</h2>
          <ul className="mt-6 space-y-6">
            {stats.subjectStats.map((subject) => (
              <li key={subject.subject}>
                <div className="flex items-center justify-between gap-4 text-sm">
                  <span className="font-bold">
                    {subjectLabels[subject.subject]}
                  </span>
                  <span className="text-muted">
                    {subject.correctCount}/{subject.answeredCount} ·{' '}
                    <strong className="text-ink">{subject.correctRate}%</strong>
                  </span>
                </div>
                <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-100">
                  <div
                    aria-label={`${subjectLabels[subject.subject]} 정답률`}
                    aria-valuemax={100}
                    aria-valuemin={0}
                    aria-valuenow={subject.correctRate}
                    className="h-full rounded-full bg-brand"
                    role="progressbar"
                    style={{ width: `${subject.correctRate}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </article>

        <article className="rounded-xl border border-line bg-white p-5 sm:p-7">
          <h2 className="text-xl font-black">최근 7일 학습량</h2>
          <ul
            aria-label="최근 7일 문제 풀이 수"
            className="mt-6 grid grid-cols-7 gap-2"
          >
            {stats.dailyStudyCountLast7Days.map((day) => {
              const height = Math.max(
                8,
                Math.round((day.count / maxDailyCount) * 112)
              )

              return (
                <li
                  className="flex min-w-0 flex-col items-center"
                  key={day.date}
                >
                  <span className="text-xs font-bold">{day.count}</span>
                  <div className="mt-2 flex h-28 w-full items-end rounded-md bg-slate-50">
                    <span
                      aria-hidden="true"
                      className="block w-full rounded-md bg-emerald-600"
                      style={{ height: `${height}px` }}
                    />
                  </div>
                  <span className="mt-2 text-[11px] text-muted">
                    {formatDailyDate(day.date)}
                  </span>
                </li>
              )
            })}
          </ul>
          <p className="mt-5 text-sm text-muted">
            차트의 숫자와 날짜를 함께 제공해 색상이나 막대 높이에만 의존하지
            않습니다.
          </p>
        </article>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <article className="rounded-xl border border-line bg-white p-5 sm:p-7">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-xl font-black">최근 학습 기록</h2>
            <Badge>{stats.recentStudySessions.length}개</Badge>
          </div>
          {stats.recentStudySessions.length > 0 ? (
            <ul className="mt-5 divide-y divide-line">
              {stats.recentStudySessions.map((session) => (
                <li
                  className="flex items-center justify-between gap-4 py-4"
                  key={session.id}
                >
                  <div>
                    <p className="font-bold">
                      {session.level} · {subjectLabels[session.subject]}
                    </p>
                    <p className="mt-1 text-sm text-muted">
                      {formatDate(session.submittedAt)} · {session.correctCount}
                      /{session.totalCount} 정답
                    </p>
                  </div>
                  <Badge variant="success">정답률 {session.correctRate}%</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-5 text-sm text-muted">최근 세션이 없습니다.</p>
          )}
        </article>

        <article className="rounded-xl border border-line bg-white p-5 sm:p-7">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-black">반복 오답 상위 문제</h2>
            <Link
              className="inline-flex min-h-11 items-center px-1 text-sm font-bold text-brand underline underline-offset-2 hover:no-underline"
              to="/wrong-notes?view=REPEATED&sort=MOST_WRONG"
            >
              복습 센터에서 보기
            </Link>
          </div>
          {stats.repeatedWrongQuestions.length > 0 ? (
            <ol className="mt-5 divide-y divide-line">
              {stats.repeatedWrongQuestions.map((question, index) => (
                <li className="flex gap-4 py-4" key={question.questionId}>
                  <span className="font-black text-brand">{index + 1}</span>
                  <div className="min-w-0 flex-1">
                    <Link
                      className="inline-flex min-h-11 items-center font-semibold hover:text-brand hover:underline"
                      to={`/wrong-notes/${question.questionId}?returnTo=${encodeURIComponent('/dashboard')}`}
                    >
                      {question.questionText}
                    </Link>
                    <p className="mt-1 text-sm text-muted">
                      {question.level} · {subjectLabels[question.subject]} ·{' '}
                      {question.wrongCount}회 오답
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-5 text-sm text-muted">
              반복해서 틀린 문제가 없습니다.
            </p>
          )}
        </article>
      </div>
    </>
  )
}
