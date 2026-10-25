import {
  questionVersionStatusSchema,
  type QuestionVersionStatus
} from '@nihongo/contracts/admin/phase7'
import { AppLink } from '@nihongo/browser/common/components/AppLink'
import { useAppStore } from '@nihongo/browser/store/index'
import { useEffect, useState } from 'react'
import { Link, useSearchParams, useLocation } from 'react-router'
import type { FormEvent, ReactElement } from 'react'
import type { ListAdminQuestionResponse } from '@nihongo/browser/api/admin-question/listAdminQuestion/schema'
import type {
  JlptLevel,
  QuestionDifficulty,
  QuestionSubject
} from '@nihongo/browser/common/types/domain'
import {
  LEVELS,
  QUESTION_DIFFICULTIES,
  SUBJECTS
} from '@nihongo/browser/common/types/domain'
import { useDeleteAdminQuestion } from '@app/admin-question/hooks/useDeleteAdminQuestion'
import { useListAdminQuestions } from '@app/admin-question/hooks/useListAdminQuestions'
import { Badge } from '@nihongo/browser/common/components/Badge'
import { Button } from '@nihongo/browser/common/components/Button'
import { Dialog } from '@nihongo/browser/common/components/Dialog'
import { EmptyState } from '@nihongo/browser/common/components/EmptyState'
import { ErrorState } from '@nihongo/browser/common/components/ErrorState'
import { Input } from '@nihongo/browser/common/components/Input'
import { LoadingState } from '@nihongo/browser/common/components/LoadingState'
import { Pagination } from '@nihongo/browser/common/components/Pagination'
import { Select } from '@nihongo/browser/common/components/Select'
import { useToast } from '@nihongo/browser/common/components/Toast'

type AdminQuestionSummary = ListAdminQuestionResponse['items'][number]
type AdminQuestionSort = 'UPDATED_DESC' | 'LEVEL_ASC'

const LEVEL_SET: ReadonlySet<string> = new Set(LEVELS)
const SUBJECT_SET: ReadonlySet<string> = new Set(SUBJECTS)
const STATUS_SET: ReadonlySet<string> = new Set(
  questionVersionStatusSchema.options
)
const DIFFICULTY_SET: ReadonlySet<string> = new Set(QUESTION_DIFFICULTIES)
const SORT_SET: ReadonlySet<string> = new Set(['UPDATED_DESC', 'LEVEL_ASC'])

const subjectLabels = {
  VOCABULARY: '문자·어휘',
  GRAMMAR: '문법',
  READING: '독해'
} as const

const questionTypeLabels = {
  KANJI_READING: '한자 읽기',
  ORTHOGRAPHY: '표기',
  CONTEXT_VOCABULARY: '문맥 어휘',
  PARAPHRASE: '바꿔 말하기',
  WORD_USAGE: '단어 용법',
  GRAMMAR_SELECT: '문법 선택',
  SENTENCE_ORDER: '문장 배열',
  TEXT_GRAMMAR: '지문 문법',
  SHORT_READING: '단문 독해',
  MEDIUM_READING: '중문 독해',
  LONG_READING: '장문 독해',
  INFO_RETRIEVAL: '정보 검색'
} as const

const difficultyLabels = {
  EASY: '쉬움',
  NORMAL: '보통',
  HARD: '어려움'
} as const

const statusLabels = {
  DRAFT: '초안',
  PUBLISHED: '공개',
  IN_REVIEW: '검토 중',
  CHANGES_REQUESTED: '수정 요청',
  APPROVED: '검토 승인·미공개',
  RETIRED: '사용 종료'
} as const

const sortLabels: Record<AdminQuestionSort, string> = {
  UPDATED_DESC: '최근 수정순',
  LEVEL_ASC: '급수순'
}

const dateFormatter = new Intl.DateTimeFormat('ko-KR', {
  dateStyle: 'medium',
  timeStyle: 'short'
})

const numberFormatter = new Intl.NumberFormat('ko-KR')

const isJlptLevel = (value: string | null): value is JlptLevel => {
  return value !== null && LEVEL_SET.has(value)
}

const isQuestionSubject = (value: string | null): value is QuestionSubject => {
  return value !== null && SUBJECT_SET.has(value)
}

const isQuestionStatus = (
  value: string | null
): value is QuestionVersionStatus => {
  return value !== null && STATUS_SET.has(value)
}

const isQuestionDifficulty = (
  value: string | null
): value is QuestionDifficulty => {
  return value !== null && DIFFICULTY_SET.has(value)
}

const isAdminQuestionSort = (
  value: string | null
): value is AdminQuestionSort => {
  return value !== null && SORT_SET.has(value)
}

const parsePositiveInteger = (value: string | null): number => {
  const parsedValue = Number(value)
  return Number.isInteger(parsedValue) && parsedValue > 0 ? parsedValue : 1
}

const formatUpdatedAt = (value: string): string => {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return '날짜 정보 없음'
  }

  return dateFormatter.format(date)
}

export const AdminQuestionPage = (): ReactElement => {
  const [searchParams, setSearchParams] = useSearchParams()
  const location = useLocation()
  const actorId = useAppStore((state) => state.currentUser?.id)
  const [unsupportedSort] = useState(
    () => searchParams.get('sort') === 'STATUS'
  )
  const [archiveRefreshFailed, setArchiveRefreshFailed] = useState(false)
  const [questionToDelete, setQuestionToDelete] =
    useState<AdminQuestionSummary | null>(null)
  const deleteQuestion = useDeleteAdminQuestion()
  const { addToast } = useToast()
  const search = searchParams.get('search')?.trim() ?? ''
  const rawLevel = searchParams.get('level')
  const rawSubject = searchParams.get('subject')
  const rawStatus = searchParams.get('status')
  const rawDifficulty = searchParams.get('difficulty')
  const rawSort = searchParams.get('sort')
  const level = isJlptLevel(rawLevel) ? rawLevel : undefined
  const subject = isQuestionSubject(rawSubject) ? rawSubject : undefined
  const status = isQuestionStatus(rawStatus) ? rawStatus : undefined
  const difficulty = isQuestionDifficulty(rawDifficulty)
    ? rawDifficulty
    : undefined
  const sort = isAdminQuestionSort(rawSort)
    ? rawSort
    : rawSort === 'LEVEL'
      ? 'LEVEL_ASC'
      : 'UPDATED_DESC'
  const page = parsePositiveInteger(searchParams.get('page'))
  const questionList = useListAdminQuestions({
    q: search || undefined,
    level,
    subject,
    versionStatus: status,
    lifecycleStatus: 'ACTIVE',
    difficulty,
    sort,
    page,
    pageSize: 20
  })
  const hasActiveFilters = Boolean(
    search ||
      level ||
      subject ||
      status ||
      difficulty ||
      sort !== 'UPDATED_DESC'
  )

  useEffect(() => {
    if (!rawSort || isAdminQuestionSort(rawSort)) return
    const next = new URLSearchParams(searchParams)
    if (rawSort === 'LEVEL') next.set('sort', 'LEVEL_ASC')
    else next.delete('sort')
    if (rawSort !== 'LEVEL' && rawSort !== 'RECENT') next.delete('page')
    setSearchParams(next, { replace: true })
  }, [rawSort, searchParams, setSearchParams])
  const archiveError = deleteQuestion.apiError
  const needsFresh = archiveError?.code === 'FRESH_ASSURANCE_REQUIRED'
  const archiveConflict = archiveError?.code === 'VERSION_CONFLICT'
  const canEdit = (question: AdminQuestionSummary): boolean =>
    Boolean(actorId) &&
    question.lifecycleStatus === 'ACTIVE' &&
    question.author?.actorId === actorId &&
    ['DRAFT', 'CHANGES_REQUESTED'].includes(question.versionStatus)

  const setFilter = (key: string, value: string): void => {
    const nextParams = new URLSearchParams(searchParams)

    if (value.length === 0 || (key === 'sort' && value === 'UPDATED_DESC')) {
      nextParams.delete(key)
    } else {
      nextParams.set(key, value)
    }

    if (key !== 'page') {
      nextParams.delete('page')
    }

    setSearchParams(nextParams)
  }

  const handleSearch = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const nextSearch = String(formData.get('search') ?? '').trim()
    setFilter('search', nextSearch)
  }

  const openDeleteDialog = (question: AdminQuestionSummary): void => {
    deleteQuestion.reset()
    setArchiveRefreshFailed(false)
    setQuestionToDelete(question)
  }

  const handleDeleteQuestion = async (): Promise<void> => {
    if (!questionToDelete) {
      return
    }

    try {
      await deleteQuestion.mutateAsync({
        questionId: questionToDelete.questionId,
        input: {
          expectedQuestionRowVersion: questionToDelete.questionRowVersion,
          expectedOpenCandidateVersionId:
            questionToDelete.openCandidateVersionId,
          expectedOpenCandidateRowVersion:
            questionToDelete.openCandidateVersionId
              ? questionToDelete.versionRowVersion
              : null
        }
      })
      addToast({
        title: '문제를 보관했습니다',
        description: `${questionToDelete.questionId} 문제가 활성 목록에서 제외되었습니다.`,
        variant: 'success'
      })
      setQuestionToDelete(null)
    } catch {
      // 전역 API 에러 프로바이더가 오류 유형에 맞는 안내를 표시합니다.
    }
  }

  const totalPages = questionList.data
    ? Math.max(
        1,
        Math.ceil(questionList.data.total / questionList.data.pageSize)
      )
    : 1
  const isOutOfRangePage = Boolean(
    questionList.data &&
      questionList.data.total > 0 &&
      questionList.data.items.length === 0
  )

  useEffect(() => {
    if (!isOutOfRangePage || page <= totalPages) {
      return
    }

    const nextParams = new URLSearchParams(searchParams)
    if (totalPages === 1) {
      nextParams.delete('page')
    } else {
      nextParams.set('page', String(totalPages))
    }
    setSearchParams(nextParams, { replace: true })
  }, [isOutOfRangePage, page, searchParams, setSearchParams, totalPages])

  return (
    <section className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 sm:py-14">
      <div className="flex flex-col gap-6 border-b border-line pb-8 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-3xl">
          <p className="text-sm font-bold tracking-[0.14em] text-brand">
            ADMIN QUESTION CMS
          </p>
          <h1 className="mt-2 text-balance text-3xl font-black tracking-tight sm:text-4xl">
            문제 관리
          </h1>
          <p className="mt-4 text-pretty leading-7 text-muted">
            활성 문제의 대표 버전을 관리합니다. 작성·검토 중인 버전이 있으면
            먼저 표시하며, 공개본 유무는 별도로 표시합니다. 목록에는 정답과
            해설을 노출하지 않습니다.
          </p>
        </div>
        <Link
          className="inline-flex min-h-12 shrink-0 items-center justify-center rounded-lg bg-brand px-5 py-3 font-semibold text-white shadow-sm hover:bg-emerald-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          to={`/questions/new?returnTo=${encodeURIComponent('/admin/questions' + location.search)}`}
        >
          새 문제 등록
        </Link>
      </div>

      {unsupportedSort ? (
        <p role="status" className="mt-5 text-sm text-muted">
          상태순 정렬은 지원하지 않아 최근 수정순으로 표시합니다.
        </p>
      ) : null}
      <div className="mt-8 rounded-2xl border border-line bg-white p-4 shadow-sm sm:p-6">
        <form
          key={search}
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
          role="search"
          onSubmit={handleSearch}
        >
          <div className="min-w-0 flex-1">
            <Input
              name="search"
              label="문제 검색"
              defaultValue={search}
              placeholder="질문이 시작하는 내용을 입력하세요…"
              autoComplete="off"
            />
          </div>
          <Button className="sm:mb-0" type="submit">
            검색
          </Button>
        </form>

        <fieldset className="mt-5 border-t border-line pt-5">
          <legend className="sr-only">문제 목록 필터와 정렬</legend>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <Select
              name="level"
              label="급수"
              value={level ?? ''}
              onChange={(event) =>
                setFilter('level', event.currentTarget.value)
              }
            >
              <option value="">전체 급수</option>
              {LEVELS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </Select>
            <Select
              name="subject"
              label="과목"
              value={subject ?? ''}
              onChange={(event) =>
                setFilter('subject', event.currentTarget.value)
              }
            >
              <option value="">전체 과목</option>
              {SUBJECTS.map((value) => (
                <option key={value} value={value}>
                  {subjectLabels[value]}
                </option>
              ))}
            </Select>
            <Select
              name="status"
              label="상태"
              value={status ?? ''}
              onChange={(event) =>
                setFilter('status', event.currentTarget.value)
              }
            >
              <option value="">모든 표시 버전 상태</option>
              {questionVersionStatusSchema.options.map((value) => (
                <option key={value} value={value}>
                  {statusLabels[value]}
                </option>
              ))}
            </Select>
            <Select
              name="difficulty"
              label="난이도"
              value={difficulty ?? ''}
              onChange={(event) =>
                setFilter('difficulty', event.currentTarget.value)
              }
            >
              <option value="">전체 난이도</option>
              {QUESTION_DIFFICULTIES.map((value) => (
                <option key={value} value={value}>
                  {difficultyLabels[value]}
                </option>
              ))}
            </Select>
            <Select
              name="sort"
              label="정렬"
              value={sort}
              onChange={(event) => setFilter('sort', event.currentTarget.value)}
            >
              {Object.entries(sortLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
        </fieldset>

        <div className="mt-5 flex min-h-11 flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
          <p className="text-sm text-muted" aria-live="polite">
            {questionList.data
              ? `총 ${numberFormatter.format(questionList.data.total)}개 문제`
              : '문제 수를 확인하는 중입니다…'}
          </p>
          {hasActiveFilters ? (
            <button
              className="min-h-11 rounded-lg px-3 text-sm font-semibold text-brand underline underline-offset-4 hover:no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              type="button"
              onClick={() => setSearchParams({})}
            >
              필터 초기화
            </button>
          ) : null}
        </div>
      </div>

      {questionList.isPending ? (
        <LoadingState message="관리자 문제 목록을 불러오고 있습니다…" />
      ) : null}

      {questionList.isError ? (
        <div className="mt-8">
          <ErrorState
            title="문제 목록을 불러오지 못했습니다"
            description="네트워크 상태를 확인한 뒤 다시 시도해 주세요."
            onRetry={() => void questionList.refetch()}
          />
        </div>
      ) : null}

      {isOutOfRangePage ? (
        <LoadingState message="유효한 문제 목록 페이지로 이동하고 있습니다." />
      ) : null}

      {questionList.data &&
      questionList.data.items.length === 0 &&
      !isOutOfRangePage ? (
        <EmptyState
          className="mt-8 rounded-2xl border border-line bg-white"
          title={
            hasActiveFilters
              ? '검색 조건에 맞는 문제가 없습니다'
              : '등록된 문제가 없습니다'
          }
          description={
            hasActiveFilters
              ? '검색어나 필터를 변경하여 다시 확인해 주세요.'
              : '첫 자체 제작 문제를 등록하여 문제 은행을 구성해 보세요.'
          }
          action={
            hasActiveFilters ? (
              <Button variant="outline" onClick={() => setSearchParams({})}>
                필터 초기화
              </Button>
            ) : (
              <Link
                className="inline-flex min-h-11 items-center justify-center rounded-lg bg-brand px-4 py-2.5 font-semibold text-white hover:bg-emerald-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                to={`/questions/new?returnTo=${encodeURIComponent('/admin/questions' + location.search)}`}
              >
                첫 문제 등록
              </Link>
            )
          }
        />
      ) : null}

      {questionList.data && questionList.data.items.length > 0 ? (
        <>
          <p
            className="mt-8 text-sm text-muted lg:sr-only"
            id="admin-question-table-help"
          >
            표를 좌우로 스크롤하면 모든 열과 관리 버튼을 확인할 수 있습니다.
          </p>
          <div
            className="mt-2 overflow-x-auto rounded-2xl border border-line bg-white shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            role="region"
            aria-label="관리자 문제 목록"
            aria-describedby="admin-question-table-help"
            tabIndex={0}
          >
            <table className="w-full min-w-[76rem] border-collapse text-left text-sm">
              <caption className="sr-only">
                JLPT 관리자 문제 목록. 수정 및 보관 작업을 포함합니다.
              </caption>
              <thead className="bg-slate-50 text-slate-700">
                <tr>
                  <th className="px-4 py-3 font-semibold" scope="col">
                    ID
                  </th>
                  <th
                    className="px-4 py-3 font-semibold"
                    scope="col"
                    aria-sort={sort === 'LEVEL_ASC' ? 'ascending' : undefined}
                  >
                    급수
                  </th>
                  <th className="px-4 py-3 font-semibold" scope="col">
                    과목
                  </th>
                  <th className="px-4 py-3 font-semibold" scope="col">
                    유형
                  </th>
                  <th className="w-[22rem] px-4 py-3 font-semibold" scope="col">
                    질문
                  </th>
                  <th className="px-4 py-3 font-semibold" scope="col">
                    난이도
                  </th>
                  <th
                    className="px-4 py-3 font-semibold"
                    scope="col"
                    aria-sort={undefined}
                  >
                    상태
                  </th>
                  <th className="w-48 px-4 py-3 font-semibold" scope="col">
                    태그
                  </th>
                  <th
                    className="px-4 py-3 font-semibold"
                    scope="col"
                    aria-sort={
                      sort === 'UPDATED_DESC' ? 'descending' : undefined
                    }
                  >
                    수정일
                  </th>
                  <th
                    className="px-4 py-3 text-right font-semibold"
                    scope="col"
                  >
                    관리
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {questionList.data.items.map((question) => (
                  <tr
                    key={question.questionId}
                    className="align-top hover:bg-slate-50/80"
                  >
                    <th
                      className="max-w-40 px-4 py-4 font-mono text-xs font-semibold text-ink"
                      scope="row"
                    >
                      <span className="block break-all" translate="no">
                        {question.questionId}
                      </span>
                    </th>
                    <td className="px-4 py-4 font-bold">{question.level}</td>
                    <td className="px-4 py-4">
                      {subjectLabels[question.subject]}
                    </td>
                    <td className="px-4 py-4">
                      {questionTypeLabels[question.questionType]}
                    </td>
                    <td className="px-4 py-4">
                      <span className="line-clamp-2 leading-6">
                        {question.questionTextPreview}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      {difficultyLabels[question.difficulty]}
                    </td>
                    <td className="px-4 py-4">
                      <Badge
                        variant={
                          question.versionStatus === 'PUBLISHED'
                            ? 'success'
                            : 'neutral'
                        }
                      >
                        {statusLabels[question.versionStatus]} ·{' '}
                        {question.lifecycleStatus === 'ACTIVE'
                          ? '활성'
                          : '보관'}{' '}
                        ·{' '}
                        {question.currentPublishedVersionId
                          ? '공개본 있음'
                          : '공개본 없음'}
                      </Badge>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex max-w-48 flex-wrap gap-1.5">
                        {question.tags.map((tag) => (
                          <Badge key={tag.id}>{tag.label}</Badge>
                        ))}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 tabular-nums text-muted">
                      {formatUpdatedAt(question.updatedAt)}
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex justify-end gap-2">
                        <Link
                          className="inline-flex min-h-11 items-center justify-center rounded-lg border border-line bg-white px-3 font-semibold text-ink hover:border-slate-400 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                          to={`/questions/${question.questionId}/edit?returnTo=${encodeURIComponent('/admin/questions' + location.search)}`}
                          aria-label={`${question.questionId} 문제 ${canEdit(question) ? '수정' : '상세'}`}
                        >
                          {canEdit(question) ? '수정' : '상세'}
                        </Link>
                        <button
                          className="min-h-11 rounded-lg border border-red-200 bg-white px-3 font-semibold text-red-700 hover:bg-red-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700"
                          type="button"
                          aria-label={`${question.questionId} 문제 보관`}
                          onClick={() => openDeleteDialog(question)}
                        >
                          보관
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pagination
            className="mt-8"
            currentPage={questionList.data.page}
            totalPages={totalPages}
            onPageChange={(nextPage) => setFilter('page', String(nextPage))}
          />
        </>
      ) : null}

      <Dialog
        open={questionToDelete !== null}
        title="문제를 보관하시겠습니까?"
        description={
          questionToDelete
            ? `${questionToDelete.questionId} 문제를 활성 목록에서 보관합니다. 기존 학습 결과는 유지됩니다.`
            : undefined
        }
        footer={
          <>
            <Button
              variant="secondary"
              disabled={deleteQuestion.isPending}
              onClick={() => setQuestionToDelete(null)}
            >
              취소
            </Button>
            <Button
              variant="danger"
              isLoading={deleteQuestion.isPending}
              disabled={needsFresh || archiveConflict}
              loadingLabel="보관 중…"
              onClick={() => void handleDeleteQuestion()}
            >
              문제 보관
            </Button>
          </>
        }
        onOpenChange={(open) => {
          if (!open && !deleteQuestion.isPending) {
            setQuestionToDelete(null)
          }
        }}
      >
        <p className="leading-7 text-muted">
          활성 목록과 새 출제 대상에서 제외하고 현재 공개본과 열린 후보의 사용을
          종료합니다. 기존 학습 기록은 삭제하지 않습니다.
        </p>
        {needsFresh ? (
          <AppLink
            to={`/login?redirect=${encodeURIComponent('/admin/questions' + location.search)}`}
            className="mt-4 inline-flex min-h-11 items-center font-semibold underline"
          >
            관리자 재인증
          </AppLink>
        ) : null}
        {archiveConflict ? (
          <Button
            variant="secondary"
            onClick={() => {
              void questionList.refetch().then((result) => {
                if (result.isError || !result.data) {
                  setArchiveRefreshFailed(true)
                  return
                }
                const next = result.data.items.find(
                  (item) => item.questionId === questionToDelete?.questionId
                )
                setQuestionToDelete(next ?? null)
                deleteQuestion.reset()
                setArchiveRefreshFailed(false)
              })
            }}
          >
            최신 상태 확인
          </Button>
        ) : null}
        {archiveRefreshFailed ? (
          <p role="alert">
            최신 상태를 확인하지 못했습니다. 보관은 실행하지 않았습니다.
          </p>
        ) : null}
        {deleteQuestion.isError ? (
          <p className="mt-4 text-sm font-semibold text-red-700" role="alert">
            {needsFresh
              ? '관리자 재인증이 필요합니다. 재인증 후 목록에서 다시 확인해 보관해 주세요.'
              : archiveConflict
                ? '다른 변경이 먼저 저장되었습니다. 최신 상태를 확인한 뒤 다시 보관해 주세요.'
                : (archiveError?.serverMessage ??
                  '문제를 보관하지 못했습니다. 잠시 후 다시 시도해 주세요.')}
          </p>
        ) : null}
      </Dialog>
    </section>
  )
}
