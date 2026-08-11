import '@testing-library/jest-dom/vitest'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import type { CreateAdminQuestionRequest } from '@api/admin-question/createAdminQuestion/schema'
import type { QuestionRecord } from '@common/types/domain'
import {
  QuestionForm,
  questionFormSchema,
  type QuestionFormValues
} from '@app/admin-question/components/QuestionForm'

const validFormValues: QuestionFormValues = {
  level: 'N3',
  subject: 'GRAMMAR',
  questionType: 'GRAMMAR_SELECT',
  passage: '',
  questionText: '（　）に入る表現として最も自然なものを選んでください。',
  options: [
    { label: '1', text: 'ので' },
    { label: '2', text: 'のに' },
    { label: '3', text: 'まで' },
    { label: '4', text: 'しか' }
  ],
  correctOptionId: '1',
  explanationKo: '이유를 나타내는 「ので」가 문맥에 맞습니다.',
  explanationJa: '',
  difficulty: 'NORMAL',
  tagsText: '이유, 접속 표현',
  status: 'DRAFT'
}

const initialQuestion: QuestionRecord = {
  id: 'question-admin-test',
  level: 'N3',
  subject: 'GRAMMAR',
  questionType: 'GRAMMAR_SELECT',
  passage: null,
  questionText: validFormValues.questionText,
  options: validFormValues.options.map((option) => ({
    ...option,
    id: `question-admin-test-option-${option.label}`,
    isCorrect: option.label === '1'
  })),
  explanationKo: validFormValues.explanationKo,
  explanationJa: null,
  difficulty: 'NORMAL',
  tags: ['이유', '접속 표현'],
  status: 'DRAFT',
  sourceType: 'ORIGINAL',
  createdAt: '2026-08-09T00:00:00.000Z',
  updatedAt: '2026-08-09T00:00:00.000Z'
}

const getIssueMessages = (values: unknown): string[] => {
  const result = questionFormSchema.safeParse(values)
  return result.success ? [] : result.error.issues.map((issue) => issue.message)
}

const renderQuestionForm = (
  onSubmit: (input: CreateAdminQuestionRequest) => Promise<void>,
  question?: QuestionRecord
): ReactElement => {
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: (
          <QuestionForm
            initialQuestion={question}
            isSubmitting={false}
            submitLabel="문제 등록"
            submittingLabel="등록 중…"
            onSubmit={onSubmit}
          />
        )
      },
      {
        path: '/admin/questions',
        element: <p>문제 목록</p>
      }
    ],
    { initialEntries: ['/'] }
  )

  return <RouterProvider router={router} />
}

describe('questionFormSchema', () => {
  it('보기를 정확히 4개 요구한다', () => {
    const messages = getIssueMessages({
      ...validFormValues,
      options: validFormValues.options.slice(0, 3)
    })

    expect(messages).toContain('보기는 정확히 4개여야 합니다.')
  })

  it('빈 보기와 중복 보기를 거부한다', () => {
    const blankMessages = getIssueMessages({
      ...validFormValues,
      options: validFormValues.options.map((option, index) => ({
        ...option,
        text: index === 2 ? '   ' : option.text
      }))
    })
    const duplicateMessages = getIssueMessages({
      ...validFormValues,
      options: validFormValues.options.map((option, index) => ({
        ...option,
        text: index === 1 ? validFormValues.options[0].text : option.text
      }))
    })

    expect(blankMessages).toContain('보기 내용을 입력해 주세요.')
    expect(duplicateMessages).toContain(
      '동일한 보기를 중복해서 입력할 수 없습니다.'
    )
  })

  it('정답을 정확히 하나 선택하도록 검증한다', () => {
    const messages = getIssueMessages({
      ...validFormValues,
      correctOptionId: ''
    })

    expect(messages).toContain('정답은 보기 중 정확히 하나를 선택해 주세요.')
  })

  it('독해 문제에 지문을 요구한다', () => {
    const messages = getIssueMessages({
      ...validFormValues,
      subject: 'READING',
      questionType: 'SHORT_READING',
      passage: '   '
    })

    expect(messages).toContain('독해 문제는 지문을 입력해 주세요.')
  })
})

describe('QuestionForm', () => {
  it('보기 입력 4개를 제공하고 잘못된 제출을 막는다', async () => {
    const user = userEvent.setup()
    const handleSubmit = vi.fn(
      async (_input: CreateAdminQuestionRequest) => undefined
    )
    render(renderQuestionForm(handleSubmit))

    expect(
      screen.getAllByRole('textbox', { name: /^보기 [1-4]$/ })
    ).toHaveLength(4)

    await user.click(screen.getByRole('button', { name: '문제 등록' }))

    expect(await screen.findByText('질문을 입력해 주세요.')).toBeVisible()
    expect(
      screen.getByText('정답은 보기 중 정확히 하나를 선택해 주세요.')
    ).toBeVisible()
    expect(handleSubmit).not.toHaveBeenCalled()
  })

  it('수정 값을 API 입력 구조로 변환해 제출한다', async () => {
    const user = userEvent.setup()
    const handleSubmit = vi.fn(
      async (_input: CreateAdminQuestionRequest) => undefined
    )
    render(renderQuestionForm(handleSubmit, initialQuestion))

    await user.click(screen.getByRole('button', { name: '문제 등록' }))

    await waitFor(() => expect(handleSubmit).toHaveBeenCalledTimes(1))
    expect(handleSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'N3',
        subject: 'GRAMMAR',
        passage: null,
        correctOptionId: '1',
        tags: ['이유', '접속 표현'],
        explanationJa: null
      })
    )
    expect(handleSubmit.mock.calls[0][0].options).toHaveLength(4)
  })

  it('중복 보기를 인라인 오류로 안내한다', async () => {
    const user = userEvent.setup()
    const handleSubmit = vi.fn(
      async (_input: CreateAdminQuestionRequest) => undefined
    )
    render(renderQuestionForm(handleSubmit, initialQuestion))

    const secondOption = screen.getByRole('textbox', { name: '보기 2' })
    await user.clear(secondOption)
    await user.type(secondOption, validFormValues.options[0].text)
    await user.click(screen.getByRole('button', { name: '문제 등록' }))

    expect(
      await screen.findByText('동일한 보기를 중복해서 입력할 수 없습니다.')
    ).toBeVisible()
    expect(handleSubmit).not.toHaveBeenCalled()
  })

  it('독해 과목으로 바꾸면 지문 오류를 연결해 표시한다', async () => {
    const user = userEvent.setup()
    const handleSubmit = vi.fn(
      async (_input: CreateAdminQuestionRequest) => undefined
    )
    render(renderQuestionForm(handleSubmit, initialQuestion))

    await user.selectOptions(
      screen.getByRole('combobox', { name: '과목' }),
      'READING'
    )
    await user.click(screen.getByRole('button', { name: '문제 등록' }))

    expect(
      await screen.findByText('독해 문제는 지문을 입력해 주세요.')
    ).toBeVisible()
    expect(
      screen.getByRole('textbox', { name: '지문 (필수)' })
    ).toHaveAttribute('aria-invalid', 'true')
    expect(handleSubmit).not.toHaveBeenCalled()
  })
})
