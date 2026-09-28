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

export const CreateAdminQuestionPage = (): ReactElement => {
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
      ? `${error.serverMessage ?? error.message}${
          error.retryAfterMs
            ? ` ${Math.ceil(error.retryAfterMs / 1000)}초 뒤 다시 시도해 주세요.`
            : ''
        }`
      : '문제를 만들지 못했습니다.'
    : undefined
  const serverFieldErrors =
    error && isPhase7UiApiError(error) ? error.fieldErrors : undefined

  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
      <nav aria-label="현재 위치">
        <ol className="flex flex-wrap items-center gap-2 text-sm text-muted">
          <li>
            <Link
              className="font-semibold text-brand underline"
              to="/admin/questions"
            >
              문제 관리
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li aria-current="page">새 문제</li>
        </ol>
      </nav>
      <header className="mb-8 mt-6 border-b border-line pb-8">
        <p className="text-sm font-bold tracking-[0.14em] text-brand">
          CREATE DRAFT
        </p>
        <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">
          새 문제 초안 만들기
        </h1>
        <p className="mt-4 max-w-3xl leading-7 text-muted">
          생성 결과는 항상 새 DRAFT 버전입니다. 공개 상태를 폼에서 직접 지정할
          수 없습니다.
        </p>
      </header>
      <Phase7QuestionEditor
        isSubmitting={createQuestion.isPending}
        mode="create"
        serverFieldErrors={serverFieldErrors}
        serverMessage={serverMessage}
        submitLabel="초안 만들기"
        onSubmit={handleSubmit}
      />
    </section>
  )
}
