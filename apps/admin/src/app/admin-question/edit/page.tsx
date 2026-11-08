import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import type { ReactElement } from 'react'
import { isNotFoundApiError } from '@nihongo/browser/util/apiError'
import {
  updateQuestionVersionRequestSchema,
  type CreateAdminQuestionRequest,
  type UpdateQuestionVersionRequest
} from '@nihongo/contracts/admin/content-operations'
import { useAppStore } from '@nihongo/browser/store/index'
import { Button } from '@nihongo/browser/common/components/Button'
import { Dialog } from '@nihongo/browser/common/components/Dialog'
import { QuestionForm } from '@app/admin-question/components/QuestionForm'
import { useGetAdminQuestion } from '@app/admin-question/hooks/useGetAdminQuestion'
import { useUpdateAdminQuestion } from '@app/admin-question/hooks/useUpdateAdminQuestion'
import { ErrorState } from '@nihongo/browser/common/components/ErrorState'
import { LoadingState } from '@nihongo/browser/common/components/LoadingState'
import { useToast } from '@nihongo/browser/common/components/Toast'
import { QuestionPageHeader } from '@app/admin-question/components/QuestionPageHeader'
import { useQuestionListReturnPath } from '@app/admin-question/navigation/useQuestionListReturnPath'
import { getAdminErrorKey } from '@app/admin/presentation/adminPresentation'
import { getTagServerErrorKey } from '@app/admin-question/components/questionTagServerError'
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'
import { PageContainer } from '@nihongo/browser/common/components/PageContainer'

export const EditAdminQuestionPage = (): ReactElement => {
  const { t, presentError } = useAdminPresentation()
  const { questionId = '' } = useParams()
  const navigate = useNavigate()
  const returnPath = useQuestionListReturnPath()
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
  const tagErrorKey = updateQuestion.isError
    ? getTagServerErrorKey(commandError)
    : null
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
      // The global API error provider and inline form errors explain the failure.
    }
  }

  if (!working && question.isPending) {
    return <LoadingState message={t('editor.page.loading')} />
  }

  if (!working && question.isError && isNotFoundApiError(question.error)) {
    return (
      <PageContainer width="5xl">
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
      </PageContainer>
    )
  }

  if (
    (!working && question.isError) ||
    !question.data ||
    !question.version ||
    !question.preview
  ) {
    return (
      <PageContainer width="5xl">
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
      </PageContainer>
    )
  }

  return (
    <PageContainer width="5xl">
      <QuestionPageHeader
        returnPath={returnPath}
        currentLabel={t('editor.page.breadcrumb', {
          questionId: question.data.question.questionId
        })}
        currentClassName="max-w-64 truncate"
        title={t(canEdit ? 'editor.page.title' : 'editor.page.details')}
        description={t('editor.page.description', {
          questionId: question.data.question.questionId
        })}
        headingRef={headingRef}
      />

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
                : getAdminErrorKey(commandError) === 'errors.generic'
                  ? t('editor.page.saveError')
                  : presentError(commandError)
            : undefined
        }
        serverTagError={tagErrorKey ? t(tagErrorKey) : undefined}
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
    </PageContainer>
  )
}
