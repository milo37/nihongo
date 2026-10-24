import { safeSsoReturnPath } from '@nihongo/contracts/auth/sign-in-social'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import type { ReactElement } from 'react'
import { isNotFoundApiError } from '@util/apiError'
import {
  updateQuestionVersionRequestSchema,
  type CreateAdminQuestionRequest,
  type UpdateQuestionVersionRequest
} from '@nihongo/contracts/admin/phase7'
import { useAppStore } from '@store/index'
import { Button } from '@common/components/Button'
import { Dialog } from '@common/components/Dialog'
import { QuestionForm } from '@app/admin-question/components/QuestionForm'
import { useGetAdminQuestion } from '@app/admin-question/hooks/useGetAdminQuestion'
import { useUpdateAdminQuestion } from '@app/admin-question/hooks/useUpdateAdminQuestion'
import { ErrorState } from '@common/components/ErrorState'
import { LoadingState } from '@common/components/LoadingState'
import { useToast } from '@common/components/Toast'

export const EditAdminQuestionPage = (): ReactElement => {
  const { questionId = '' } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const safeReturn = safeSsoReturnPath(searchParams.get('returnTo'))
  const returnPath =
    safeReturn.split('?')[0] === '/admin/questions'
      ? safeReturn
      : '/admin/questions'
  const query = useGetAdminQuestion(questionId)
  const [working, setWorking] = useState<{
    data: NonNullable<typeof query.data>
    version: NonNullable<typeof query.version>
    preview: NonNullable<typeof query.preview>
  } | null>(null)
  if (!working && query.data && query.version && query.preview) {
    setWorking({
      data: query.data,
      version: query.version,
      preview: query.preview
    })
  }
  const question = { ...query, ...working }
  const updateQuestion = useUpdateAdminQuestion()
  const { addToast } = useToast()
  const actorId = useAppStore((state) => state.currentUser?.id)
  const [reloadOpen, setReloadOpen] = useState(false)
  const [formRevision, setFormRevision] = useState(0)
  const [reloadFailed, setReloadFailed] = useState(false)
  const commandError = updateQuestion.apiError
  const conflict = commandError?.code === 'VERSION_CONFLICT'
  const blocked =
    conflict ||
    commandError?.code === 'QUESTION_VERSION_IMMUTABLE' ||
    commandError?.code === 'FORBIDDEN'
  const canEdit =
    Boolean(actorId) &&
    question.data?.question.lifecycleStatus === 'ACTIVE' &&
    question.data.question.openCandidateVersionId ===
      question.version?.questionVersionId &&
    question.version?.author?.actorId === actorId &&
    ['DRAFT', 'CHANGES_REQUESTED'].includes(
      question.version?.versionStatus ?? ''
    )
  const headingRef = useRef<HTMLHeadingElement>(null)
  const shouldRestoreRetryFocusRef = useRef(false)

  useEffect(() => {
    if (
      question.isSuccess &&
      question.data &&
      shouldRestoreRetryFocusRef.current
    ) {
      shouldRestoreRetryFocusRef.current = false
      headingRef.current?.focus()
    }
  }, [question.data, question.isSuccess])

  const handleUpdateQuestion = async (
    input: CreateAdminQuestionRequest | UpdateQuestionVersionRequest
  ): Promise<void> => {
    try {
      const updatedQuestion = await updateQuestion.mutateAsync({
        questionId,
        versionId: question.version?.questionVersionId ?? '',
        input: updateQuestionVersionRequestSchema.parse(input)
      })
      addToast({
        title: '문제를 수정했습니다',
        description: `${updatedQuestion.questionId} 문제의 변경사항이 저장되었습니다.`,
        variant: 'success'
      })
      navigate(returnPath, { replace: true })
    } catch {
      // 전역 API 에러 프로바이더와 폼의 인라인 오류가 안내합니다.
    }
  }

  if (!working && question.isPending) {
    return <LoadingState message="문제 정보를 불러오고 있습니다…" />
  }

  if (!working && question.isError && isNotFoundApiError(question.error)) {
    return (
      <section className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
        <ErrorState
          headingLevel={1}
          title="수정할 문제를 찾을 수 없습니다"
          description="문제 ID를 확인하거나 관리자 목록에서 다시 선택해 주세요."
          action={
            <Link
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-red-300 bg-white px-4 py-2.5 font-semibold text-red-800 hover:bg-red-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700"
              to={returnPath}
            >
              문제 목록으로 이동
            </Link>
          }
        />
      </section>
    )
  }

  if (
    (!working && question.isError) ||
    !question.data ||
    !question.version ||
    !question.preview
  ) {
    return (
      <section className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
        <ErrorState
          headingLevel={1}
          title="문제 정보를 불러오지 못했습니다"
          description={
            question.data && !question.version
              ? '현재 버전 정보를 확인할 수 없어 편집을 막았습니다. 목록에서 다시 선택하거나 최신 상태를 확인해 주세요.'
              : '네트워크 상태를 확인한 뒤 다시 시도해 주세요.'
          }
          onRetry={() => {
            shouldRestoreRetryFocusRef.current = true
            void question.refetch().catch(() => undefined)
          }}
        />
      </section>
    )
  }

  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
      <nav aria-label="현재 위치">
        <ol className="flex flex-wrap items-center gap-2 text-sm text-muted">
          <li>
            <Link
              className="rounded-md font-semibold text-brand underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              to={returnPath}
            >
              문제 관리
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li className="max-w-64 truncate" aria-current="page">
            {question.data.question.questionId} 수정
          </li>
        </ol>
      </nav>

      <header className="mb-8 mt-6 border-b border-line pb-8">
        <p className="text-sm font-bold tracking-[0.14em] text-brand">
          EDIT QUESTION
        </p>
        <h1
          ref={headingRef}
          className="mt-2 rounded-sm text-balance text-3xl font-black tracking-tight sm:text-4xl"
          tabIndex={-1}
        >
          {canEdit ? '문제 수정' : '문제 상세'}
        </h1>
        <p className="mt-4 max-w-3xl text-pretty leading-7 text-muted">
          <span className="font-mono font-semibold text-ink" translate="no">
            {question.data.question.questionId}
          </span>{' '}
          문제의 수정 가능한 후보 버전 내용과 해설을 저장합니다.
        </p>
      </header>

      {!canEdit ? (
        <p role="status" className="mb-5 text-sm text-muted">
          현재 버전은 수정할 수 없습니다. 활성 문제의 작성자 소유 초안·변경 요청
          버전만 수정할 수 있습니다. 게시·검수·새 버전 생성은 이 화면에서
          제공하지 않습니다.
        </p>
      ) : null}
      {conflict ? (
        <div className="mb-5" role="alert">
          <p>
            다른 변경이 먼저 저장되었습니다. 현재 입력은 유지됩니다. 필요한
            내용을 복사한 뒤 최신 상태를 다시 불러와 주세요.
          </p>
          <Button variant="secondary" onClick={() => setReloadOpen(true)}>
            최신 상태 다시 불러오기
          </Button>
        </div>
      ) : null}
      <QuestionForm
        cancelHref={returnPath}
        key={`${question.version.questionVersionId}-${formRevision}`}
        initialQuestion={question.preview}
        expectedRowVersion={question.version.rowVersion}
        readOnly={!canEdit || blocked}
        isSubmitting={updateQuestion.isPending}
        submitLabel="변경사항 저장"
        submittingLabel="저장 중…"
        serverError={
          updateQuestion.isError
            ? commandError?.code === 'QUESTION_VERSION_IMMUTABLE'
              ? '학습 또는 검수에 사용된 버전은 수정할 수 없습니다. 입력은 유지됩니다.'
              : commandError?.code === 'FORBIDDEN'
                ? '이 버전의 작성자만 수정할 수 있습니다. 입력은 유지됩니다.'
                : (commandError?.serverMessage ??
                  '변경사항을 저장하지 못했습니다. 입력은 유지됩니다. 내용을 확인한 뒤 다시 시도해 주세요.')
            : undefined
        }
        onSubmit={handleUpdateQuestion}
      />
      <Dialog
        open={reloadOpen}
        title="최신 상태로 입력을 교체하시겠습니까?"
        description="불러오면 현재 입력 대신 서버의 최신 내용이 표시됩니다. 필요한 내용을 먼저 복사해 주세요."
        onOpenChange={setReloadOpen}
        footer={
          <>
            <Button variant="secondary" onClick={() => setReloadOpen(false)}>
              입력 유지
            </Button>
            <Button
              onClick={() => {
                void query
                  .refetch()
                  .then((fresh) => {
                    setWorking(fresh)
                    updateQuestion.reset()
                    setFormRevision((revision) => revision + 1)
                    setReloadOpen(false)
                    setReloadFailed(false)
                  })
                  .catch(() => setReloadFailed(true))
              }}
            >
              입력 교체하고 불러오기
            </Button>
          </>
        }
      >
        {reloadFailed ? (
          <p role="alert">
            최신 상태를 불러오지 못했습니다. 현재 입력은 유지됩니다.
          </p>
        ) : null}
      </Dialog>
    </section>
  )
}
