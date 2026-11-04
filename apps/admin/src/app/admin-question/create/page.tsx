import { useNavigate } from 'react-router'
import type { ReactElement } from 'react'
import {
  createAdminQuestionRequestSchema,
  type CreateAdminQuestionRequest,
  type UpdateQuestionVersionRequest
} from '@nihongo/contracts/admin/content-operations'
import { QuestionForm } from '@app/admin-question/components/QuestionForm'
import { useCreateAdminQuestion } from '@app/admin-question/hooks/useCreateAdminQuestion'
import { useToast } from '@nihongo/browser/common/components/Toast'
import { QuestionPageHeader } from '@app/admin-question/components/QuestionPageHeader'
import { useQuestionListReturnPath } from '@app/admin-question/navigation/useQuestionListReturnPath'
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'

export const CreateAdminQuestionPage = (): ReactElement => {
  const { t } = useAdminPresentation()
  const navigate = useNavigate()
  const returnPath = useQuestionListReturnPath()
  const createQuestion = useCreateAdminQuestion()
  const { addToast } = useToast()

  const handleCreateQuestion = async (
    input: CreateAdminQuestionRequest | UpdateQuestionVersionRequest
  ): Promise<void> => {
    try {
      const createdQuestion = await createQuestion.mutateAsync(
        createAdminQuestionRequestSchema.parse(input)
      )
      addToast({
        title: t('create.page.successTitle'),
        description: t('create.page.successDescription'),
        variant: 'success'
      })
      navigate(
        `/questions/${createdQuestion.questionId}/edit?returnTo=${encodeURIComponent('/admin' + returnPath)}`,
        { replace: true }
      )
    } catch {
      // The global API error provider and inline form errors explain the failure.
    }
  }

  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
      <QuestionPageHeader
        returnPath={returnPath}
        currentLabel={t('create.page.title')}
        eyebrow="CREATE QUESTION"
        title={t('create.page.title')}
        description={t('create.page.description')}
      />

      <QuestionForm
        cancelHref={returnPath}
        isSubmitting={createQuestion.isPending}
        submitLabel={t('create.page.submit')}
        submittingLabel={t('create.page.submitting')}
        serverError={
          createQuestion.isError ? t('create.page.error') : undefined
        }
        onSubmit={handleCreateQuestion}
      />
    </section>
  )
}
