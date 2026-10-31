import '@testing-library/jest-dom/vitest'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nProvider } from '@nihongo/browser/provider/I18nProvider'
import { writeUiLocalePreference } from '@nihongo/browser/libs/localeStorage'
import { appI18n } from '@nihongo/browser/i18n/config'
import type { ReactElement } from 'react'
import type { CreateAdminQuestionRequest } from '@nihongo/browser/api/admin-question/createAdminQuestion/schema'
import type {
  PreviewQuestionVersionResponse,
  UpdateQuestionVersionRequest
} from '@nihongo/contracts/admin/phase7'
import { preview as initialQuestion } from '@app/admin-question/test/questionFixture'
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
  tagsText: '이유, 접속 표현'
}

const getIssueMessages = (values: unknown): string[] => {
  const result = questionFormSchema.safeParse(values)
  return result.success ? [] : result.error.issues.map((issue) => issue.message)
}

const renderQuestionForm = (
  onSubmit: (
    input: CreateAdminQuestionRequest | UpdateQuestionVersionRequest
  ) => Promise<void>,
  question?: PreviewQuestionVersionResponse
): ReactElement => {
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: (
          <QuestionForm
            initialQuestion={question}
            expectedRowVersion={question ? 1 : undefined}
            isSubmitting={false}
            submitLabel="문제 등록"
            submittingLabel="등록 중…"
            onSubmit={onSubmit}
          />
        )
      },
      {
        path: '/questions',
        element: <p>문제 목록</p>
      }
    ],
    { initialEntries: ['/'] }
  )

  return (
    <I18nProvider>
      <RouterProvider router={router} />
    </I18nProvider>
  )
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
      async (
        _input: CreateAdminQuestionRequest | UpdateQuestionVersionRequest
      ) => undefined
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
      async (
        _input: CreateAdminQuestionRequest | UpdateQuestionVersionRequest
      ) => undefined
    )
    render(renderQuestionForm(handleSubmit, initialQuestion))

    await user.click(screen.getByRole('button', { name: '문제 등록' }))

    await waitFor(() => expect(handleSubmit).toHaveBeenCalledTimes(1))
    expect(handleSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'N3',
        subject: 'GRAMMAR',
        passage: null,
        correctOptionId: initialQuestion.adminAnswer.correctOptionId,
        expectedRowVersion: 1,
        tagNames: ['문법'],
        explanationJa: null
      })
    )
    expect(handleSubmit.mock.calls[0][0].options).toHaveLength(4)
  })

  it.each([
    { separator: '쉼표', pasted: '  문법, 표현  ' },
    { separator: '전각 쉼표', pasted: '  문법，표현  ' },
    { separator: 'LF 줄바꿈', pasted: '  문법\n표현  ' },
    { separator: 'CRLF 줄바꿈', pasted: '  문법\r\n표현  ' }
  ])(
    '$separator로 붙여넣은 태그를 두 항목으로 제출한다',
    async ({ pasted }) => {
      const user = userEvent.setup()
      const handleSubmit = vi.fn(
        async (
          _input: CreateAdminQuestionRequest | UpdateQuestionVersionRequest
        ) => undefined
      )
      render(renderQuestionForm(handleSubmit, initialQuestion))

      const tags = screen.getByRole('textbox', { name: '태그' })
      await user.clear(tags)
      await user.click(tags)
      await user.paste(pasted)
      const fieldValue = (tags as HTMLTextAreaElement).value
      expect(handleSubmit).not.toHaveBeenCalled()

      await user.click(screen.getByRole('button', { name: '문제 등록' }))
      await waitFor(() => expect(handleSubmit).toHaveBeenCalledTimes(1))
      const request = handleSubmit.mock.calls[0][0]
      expect(request).toEqual(
        expect.objectContaining({
          expectedRowVersion: 1,
          correctOptionId: initialQuestion.adminAnswer.correctOptionId,
          options: initialQuestion.question.options.map((option, index) => ({
            id: option.id,
            ordinal: index + 1,
            text: option.text
          }))
        })
      )
      expect({ fieldValue, tagNames: request.tagNames }).toEqual({
        fieldValue: pasted.replace(/\r\n/g, '\n'),
        tagNames: ['문법', '표현']
      })
    }
  )

  it('태그 입력 중 Enter는 줄을 바꾸고 명시 제출 전 저장하지 않는다', async () => {
    const user = userEvent.setup()
    const handleSubmit = vi.fn(
      async (
        _input: CreateAdminQuestionRequest | UpdateQuestionVersionRequest
      ) => undefined
    )
    render(renderQuestionForm(handleSubmit, initialQuestion))

    const tags = screen.getByRole('textbox', { name: '태그' })
    await user.clear(tags)
    await user.type(tags, '문법{Enter}표현')
    expect(tags).toHaveValue('문법\n표현')
    expect(handleSubmit).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: '문제 등록' }))
    await waitFor(() => expect(handleSubmit).toHaveBeenCalledTimes(1))
    expect(handleSubmit.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        tagNames: ['문법', '표현'],
        expectedRowVersion: 1,
        correctOptionId: initialQuestion.adminAnswer.correctOptionId,
        options: initialQuestion.question.options.map((option, index) => ({
          id: option.id,
          ordinal: index + 1,
          text: option.text
        }))
      })
    )
  })

  it('중복 보기를 인라인 오류로 안내한다', async () => {
    const user = userEvent.setup()
    const handleSubmit = vi.fn(
      async (
        _input: CreateAdminQuestionRequest | UpdateQuestionVersionRequest
      ) => undefined
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
      async (
        _input: CreateAdminQuestionRequest | UpdateQuestionVersionRequest
      ) => undefined
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

describe('question tag locale', () => {
  afterEach(async () => {
    writeUiLocalePreference('ko')
    await appI18n.changeLanguage('ko')
    document.documentElement.lang = 'ko'
  })

  it('keeps the Korean tag label and accessible hint', async () => {
    expect(writeUiLocalePreference('ko')).toBe(true)
    render(renderQuestionForm(vi.fn()))

    await waitFor(() => expect(appI18n.resolvedLanguage).toBe('ko'))
    expect(document.documentElement.lang).toBe('ko')
    expect(
      screen.getByRole('textbox', { name: '태그' })
    ).toHaveAccessibleDescription(
      '쉼표 또는 줄바꿈으로 구분합니다. 최소 1개가 필요합니다.'
    )
  })

  it('uses the Japanese tag label when the provider is set to Japanese', async () => {
    expect(writeUiLocalePreference('ja')).toBe(true)
    render(renderQuestionForm(vi.fn()))

    await waitFor(() => expect(appI18n.resolvedLanguage).toBe('ja'))
    expect(document.documentElement.lang).toBe('ja')
    expect(screen.getByRole('textbox', { name: 'タグ' })).toBeVisible()
    expect(
      screen.getByRole('textbox', { name: 'タグ' })
    ).toHaveAccessibleDescription(
      'カンマまたは改行で区切ってください。1つ以上必要です。'
    )
  })
})
