import { Link, useNavigate } from 'react-router'
import type { ReactElement } from 'react'
import type { CreateAdminQuestionRequest } from '@api/admin-question/createAdminQuestion/schema'
import { QuestionForm } from '@app/admin-question/components/QuestionForm'
import { useCreateAdminQuestion } from '@app/admin-question/hooks/useCreateAdminQuestion'
import { useToast } from '@common/components/Toast'

export const CreateAdminQuestionPage = (): ReactElement => {
  const navigate = useNavigate()
  const createQuestion = useCreateAdminQuestion()
  const { addToast } = useToast()

  const handleCreateQuestion = async (
    input: CreateAdminQuestionRequest
  ): Promise<void> => {
    try {
      const createdQuestion = await createQuestion.mutateAsync(input)
      addToast({
        title: '문제를 등록했습니다',
        description: `${createdQuestion.id} 문제가 저장되었습니다.`,
        variant: 'success'
      })
      navigate('/admin/questions', { replace: true })
    } catch {
      // 전역 API 에러 프로바이더와 폼의 인라인 오류가 안내합니다.
    }
  }

  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
      <nav aria-label="현재 위치">
        <ol className="flex flex-wrap items-center gap-2 text-sm text-muted">
          <li>
            <Link
              className="rounded-md font-semibold text-brand underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              to="/admin/questions"
            >
              문제 관리
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li aria-current="page">새 문제 등록</li>
        </ol>
      </nav>

      <header className="mb-8 mt-6 border-b border-line pb-8">
        <p className="text-sm font-bold tracking-[0.14em] text-brand">
          CREATE QUESTION
        </p>
        <h1 className="mt-2 text-balance text-3xl font-black tracking-tight sm:text-4xl">
          새 문제 등록
        </h1>
        <p className="mt-4 max-w-3xl text-pretty leading-7 text-muted">
          자체 제작한 JLPT 문제와 해설을 입력합니다. 게시 전에는 초안으로 저장해
          내용을 검토할 수 있습니다.
        </p>
      </header>

      <QuestionForm
        isSubmitting={createQuestion.isPending}
        submitLabel="문제 등록"
        submittingLabel="등록 중…"
        serverError={
          createQuestion.isError
            ? '문제를 등록하지 못했습니다. 입력 내용을 확인한 뒤 다시 시도해 주세요.'
            : undefined
        }
        onSubmit={handleCreateQuestion}
      />
    </section>
  )
}
