import { Link, useNavigate } from 'react-router'
import type { ReactElement } from 'react'
import {
  createAdminQuestionRequestSchema,
  type CreateAdminQuestionRequest,
  type UpdateQuestionVersionRequest
} from '@nihongo/contracts/admin/phase7'
import { Phase7QuestionEditor } from '@app/admin-question/components/Phase7QuestionEditor'
import {
  isPhase7UiApiError,
  useCreatePhase7AdminQuestion
} from '@app/admin-question/hooks/usePhase7AdminMutations'
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'

export const CreateAdminQuestionPage = (): ReactElement => {
  const { presentError, t } = useAdminPresentation()
  const navigate = useNavigate()
  const createQuestion = useCreatePhase7AdminQuestion()

  const handleSubmit = async (
    input: CreateAdminQuestionRequest | UpdateQuestionVersionRequest
  ): Promise<void> => {
    const request = createAdminQuestionRequestSchema.parse(input)
    const result = await createQuestion.mutateAsync(request)
    navigate(`/admin/questions/${result.questionId}`, { replace: true })
  }

  const error = createQuestion.error
  const serverMessage = error
    ? isPhase7UiApiError(error)
      ? presentError(error)
      : t('create.error')
    : undefined
  const serverFieldErrors =
    error && isPhase7UiApiError(error) ? error.fieldErrors : undefined

  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
      <nav aria-label={t('common.breadcrumbLabel')}>
        <ol className="flex flex-wrap items-center gap-2 text-sm text-muted">
          <li>
            <Link
              className="font-semibold text-brand underline"
              to="/admin/questions"
            >
              {t('common.questions')}
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li aria-current="page">{t('common.newQuestion')}</li>
        </ol>
      </nav>
      <header className="mb-8 mt-6 border-b border-line pb-8">
        <p className="text-sm font-bold tracking-[0.14em] text-brand">
          {t('create.eyebrow')}
        </p>
        <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">
          {t('create.title')}
        </h1>
        <p className="mt-4 max-w-3xl leading-7 text-muted">
          {t('create.description')}
        </p>
      </header>
      <Phase7QuestionEditor
        isSubmitting={createQuestion.isPending}
        mode="create"
        serverFieldErrors={serverFieldErrors}
        serverMessage={serverMessage}
        submitLabel={t('create.submit')}
        onSubmit={handleSubmit}
      />
    </section>
  )
}
