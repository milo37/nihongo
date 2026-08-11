import { Link, useNavigate, useParams } from 'react-router'
import type { ReactElement } from 'react'
import type { UpdateAdminQuestionRequest } from '@api/admin-question/updateAdminQuestion/schema'
import { QuestionForm } from '@app/admin-question/components/QuestionForm'
import { useGetAdminQuestion } from '@app/admin-question/hooks/useGetAdminQuestion'
import { useUpdateAdminQuestion } from '@app/admin-question/hooks/useUpdateAdminQuestion'
import { ErrorState } from '@common/components/ErrorState'
import { LoadingState } from '@common/components/LoadingState'
import { useToast } from '@common/components/Toast'

export const EditAdminQuestionPage = (): ReactElement => {
  const { questionId = '' } = useParams()
  const navigate = useNavigate()
  const question = useGetAdminQuestion(questionId)
  const updateQuestion = useUpdateAdminQuestion()
  const { addToast } = useToast()

  const handleUpdateQuestion = async (
    input: UpdateAdminQuestionRequest
  ): Promise<void> => {
    try {
      const updatedQuestion = await updateQuestion.mutateAsync({
        questionId,
        input
      })
      addToast({
        title: '문제를 수정했습니다',
        description: `${updatedQuestion.id} 문제의 변경사항이 저장되었습니다.`,
        variant: 'success'
      })
      navigate('/admin/questions', { replace: true })
    } catch {
      // 전역 API 에러 프로바이더와 폼의 인라인 오류가 안내합니다.
    }
  }

  if (question.isPending) {
    return <LoadingState message="문제 정보를 불러오고 있습니다…" />
  }

  if (question.isError || !question.data) {
    return (
      <section className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
        <ErrorState
          headingLevel={1}
          title="수정할 문제를 찾을 수 없습니다"
          description="문제 ID를 확인하거나 관리자 목록에서 다시 선택해 주세요."
          action={
            <Link
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-red-300 bg-white px-4 py-2.5 font-semibold text-red-800 hover:bg-red-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700"
              to="/admin/questions"
            >
              문제 목록으로 이동
            </Link>
          }
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
              to="/admin/questions"
            >
              문제 관리
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li className="max-w-64 truncate" aria-current="page">
            {question.data.id} 수정
          </li>
        </ol>
      </nav>

      <header className="mb-8 mt-6 border-b border-line pb-8">
        <p className="text-sm font-bold tracking-[0.14em] text-brand">
          EDIT QUESTION
        </p>
        <h1 className="mt-2 text-balance text-3xl font-black tracking-tight sm:text-4xl">
          문제 수정
        </h1>
        <p className="mt-4 max-w-3xl text-pretty leading-7 text-muted">
          <span className="font-mono font-semibold text-ink" translate="no">
            {question.data.id}
          </span>{' '}
          문제의 내용, 해설과 게시 상태를 수정합니다.
        </p>
      </header>

      <QuestionForm
        initialQuestion={question.data}
        isSubmitting={updateQuestion.isPending}
        submitLabel="변경사항 저장"
        submittingLabel="저장 중…"
        serverError={
          updateQuestion.isError
            ? '변경사항을 저장하지 못했습니다. 입력 내용을 확인한 뒤 다시 시도해 주세요.'
            : undefined
        }
        onSubmit={handleUpdateQuestion}
      />
    </section>
  )
}
