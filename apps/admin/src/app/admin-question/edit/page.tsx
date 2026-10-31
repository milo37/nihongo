import { safeSsoReturnPath } from '@nihongo/contracts/auth/sign-in-social'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import type { ReactElement } from 'react'
import { isNotFoundApiError } from '@nihongo/browser/util/apiError'
import {
  updateQuestionVersionRequestSchema,
  type CreateAdminQuestionRequest,
  type UpdateQuestionVersionRequest
} from '@nihongo/contracts/admin/phase7'
import { useAppStore } from '@nihongo/browser/store/index'
import { Button } from '@nihongo/browser/common/components/Button'
import { Dialog } from '@nihongo/browser/common/components/Dialog'
import { QuestionForm } from '@app/admin-question/components/QuestionForm'
import { useGetAdminQuestion } from '@app/admin-question/hooks/useGetAdminQuestion'
import { useUpdateAdminQuestion } from '@app/admin-question/hooks/useUpdateAdminQuestion'
import { ErrorState } from '@nihongo/browser/common/components/ErrorState'
import { LoadingState } from '@nihongo/browser/common/components/LoadingState'
import { useToast } from '@nihongo/browser/common/components/Toast'
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'

export const EditAdminQuestionPage = (): ReactElement => {
  const { t } = useAdminPresentation()
  const { questionId = '' } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const safeReturn = safeSsoReturnPath(searchParams.get('returnTo'))
  const returnPath =
    safeReturn.split('?')[0] === '/admin/questions'
      ? safeReturn.slice('/admin'.length)
      : '/questions'
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
        title: t('editor.page.successTitle'),
        description: t('editor.page.successDescription', {
          questionId: updatedQuestion.questionId
        }),
        variant: 'success'
      })
      navigate(returnPath, { replace: true })
    } catch {
      // 전역 API 에러 프로바이더와 폼의 인라인 오류가 안내합니다.
    }
  }

  if (!working && question.isPending) {
    return <LoadingState message={t('editor.page.loading')} />
  }

  if (!working && question.isError && isNotFoundApiError(question.error)) {
    return (
      <section className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
        <ErrorState
          headingLevel={1}
          title={t('editor.page.notFound')}
          description={t('editor.page.notFoundDescription')}
          action={
            <Link
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-red-300 bg-white px-4 py-2.5 font-semibold text-red-800 hover:bg-red-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700"
              to={returnPath}
            >
              {t('editor.page.goToList')}
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
          title={t('editor.page.loadError')}
          description={
            question.data && !question.version
              ? t('editor.page.missingVersion')
              : t('editor.page.networkError')
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
      <nav aria-label={t('common.breadcrumbLabel')}>
        <ol className="flex flex-wrap items-center gap-2 text-sm text-muted">
          <li>
            <Link
              className="rounded-md font-semibold text-brand underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              to={returnPath}
            >
              {t('common.questions')}
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li className="max-w-64 truncate" aria-current="page">
            {t('editor.page.breadcrumb', {
              questionId: question.data.question.questionId
            })}
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
          {t(canEdit ? 'editor.page.title' : 'editor.page.details')}
        </h1>
        <p className="mt-4 max-w-3xl text-pretty leading-7 text-muted">
          {t('editor.page.description', {
            questionId: question.data.question.questionId
          })}
        </p>
      </header>

      {!canEdit ? (
        <p role="status" className="mb-5 text-sm text-muted">
          {t('editor.page.readOnly')}
        </p>
      ) : null}
      {conflict ? (
        <div className="mb-5" role="alert">
          <p>{t('editor.page.conflict')}</p>
          <Button variant="secondary" onClick={() => setReloadOpen(true)}>
            {t('editor.page.reload')}
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
        submitLabel={t('editor.page.submit')}
        submittingLabel={t('editor.page.submitting')}
        serverError={
          updateQuestion.isError
            ? commandError?.code === 'QUESTION_VERSION_IMMUTABLE'
              ? t('editor.page.immutable')
              : commandError?.code === 'FORBIDDEN'
                ? t('editor.page.forbidden')
                : (commandError?.serverMessage ?? t('editor.page.saveError'))
            : undefined
        }
        onSubmit={handleUpdateQuestion}
      />
      <Dialog
        open={reloadOpen}
        title={t('editor.page.reloadTitle')}
        description={t('editor.page.reloadDescription')}
        onOpenChange={setReloadOpen}
        footer={
          <>
            <Button variant="secondary" onClick={() => setReloadOpen(false)}>
              {t('editor.page.keepInput')}
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
              {t('editor.page.replaceInput')}
            </Button>
          </>
        }
      >
        {reloadFailed ? (
          <p role="alert">{t('editor.page.reloadError')}</p>
        ) : null}
      </Dialog>
    </section>
  )
}
