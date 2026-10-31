import { safeSsoReturnPath } from '@nihongo/contracts/auth/sign-in-social'
import { Link, useNavigate, useSearchParams } from 'react-router'
import type { ReactElement } from 'react'
import {
  createAdminQuestionRequestSchema,
  type CreateAdminQuestionRequest,
  type UpdateQuestionVersionRequest
} from '@nihongo/contracts/admin/phase7'
import { QuestionForm } from '@app/admin-question/components/QuestionForm'
import { useCreateAdminQuestion } from '@app/admin-question/hooks/useCreateAdminQuestion'
import { useToast } from '@nihongo/browser/common/components/Toast'
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'

export const CreateAdminQuestionPage = (): ReactElement => {
  const { t } = useAdminPresentation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const safeReturn = safeSsoReturnPath(searchParams.get('returnTo'))
  const returnPath =
    safeReturn.split('?')[0] === '/admin/questions'
      ? safeReturn.slice('/admin'.length)
      : '/questions'
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
      // 전역 API 에러 프로바이더와 폼의 인라인 오류가 안내합니다.
    }
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
          <li aria-current="page">{t('create.page.title')}</li>
        </ol>
      </nav>

      <header className="mb-8 mt-6 border-b border-line pb-8">
        <p className="text-sm font-bold tracking-[0.14em] text-brand">
          CREATE QUESTION
        </p>
        <h1 className="mt-2 text-balance text-3xl font-black tracking-tight sm:text-4xl">
          {t('create.page.title')}
        </h1>
        <p className="mt-4 max-w-3xl text-pretty leading-7 text-muted">
          {t('create.page.description')}
        </p>
      </header>

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
