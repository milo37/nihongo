import '@testing-library/jest-dom/vitest'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  I18nProvider,
  useUiLocale
} from '@nihongo/browser/provider/I18nProvider'
import { writeUiLocalePreference } from '@nihongo/browser/libs/localeStorage'
import { appI18n } from '@nihongo/browser/i18n/config'
import { useState } from 'react'
import type { ReactElement } from 'react'
import type { CreateAdminQuestionRequest } from '@api/admin-question/createAdminQuestion/schema'
import type {
  PreviewQuestionVersionResponse,
  UpdateQuestionVersionRequest
} from '@nihongo/contracts/admin/content-operations'
import { preview as initialQuestion } from '@app/admin-question/test/questionFixture'
import { QuestionForm } from '@app/admin-question/components/QuestionForm'
import {
  questionFormSchema,
  type QuestionFormValues
} from '@app/admin-question/components/questionFormSchema'

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

const LocaleTestControls = (): ReactElement => {
  const { setLocale } = useUiLocale()
  return (
    <div>
      <button type="button" onClick={() => setLocale('ja')}>
        日本語
      </button>
      <button type="button" onClick={() => setLocale('ko')}>
        한국어
      </button>
    </div>
  )
}

const renderQuestionForm = (
  onSubmit: (
    input: CreateAdminQuestionRequest | UpdateQuestionVersionRequest
  ) => Promise<void>,
  question?: PreviewQuestionVersionResponse,
  withLocaleControls = false
): ReactElement => {
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: (
          <>
            {withLocaleControls ? <LocaleTestControls /> : null}
            <QuestionForm
              initialQuestion={question}
              expectedRowVersion={question ? 1 : undefined}
              isSubmitting={false}
              submitLabel="문제 등록"
              submittingLabel="등록 중…"
              onSubmit={onSubmit}
            />
          </>
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

    expect(messages).toContain('editor.form.validation.optionCount')
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

    expect(blankMessages).toContain('editor.form.validation.option')
    expect(duplicateMessages).toContain(
      'editor.form.validation.optionDuplicate'
    )
  })

  it('정답을 정확히 하나 선택하도록 검증한다', () => {
    const messages = getIssueMessages({
      ...validFormValues,
      correctOptionId: ''
    })

    expect(messages).toContain('editor.form.validation.correct')
  })

  it('독해 문제에 지문을 요구한다', () => {
    const messages = getIssueMessages({
      ...validFormValues,
      subject: 'READING',
      questionType: 'SHORT_READING',
      passage: '   '
    })

    expect(messages).toContain('editor.form.validation.passage')
  })

  it('지문을 쓸 수 없는 유형의 지문은 계약 원문 대신 안내 키로 알린다', () => {
    const messages = getIssueMessages({
      ...validFormValues,
      passage: '本文'
    })

    expect(messages).toContain('editor.form.validation.passageNotAllowed')
    expect(messages).not.toContain('passage applicability가 유효하지 않습니다.')
  })

  it('허용되지 않는 급수·과목·유형 조합을 안내 키로 알린다', () => {
    const messages = getIssueMessages({
      ...validFormValues,
      subject: 'VOCABULARY'
    })

    expect(messages).toContain('editor.form.validation.combination')
    expect(messages.some((message) => message.includes('questionType'))).toBe(
      false
    )
  })
})

describe('QuestionForm server error', () => {
  it('제출 실패 오류가 나타나면 오류 영역으로 포커스를 옮긴다', async () => {
    const user = userEvent.setup()
    const Host = (): ReactElement => {
      const [serverError, setServerError] = useState<string>()
      return (
        <>
          <button type="button" onClick={() => setServerError('저장 실패')}>
            실패 알림
          </button>
          <QuestionForm
            isSubmitting={false}
            submitLabel="문제 등록"
            submittingLabel="등록 중…"
            serverError={serverError}
            onSubmit={async () => undefined}
          />
        </>
      )
    }
    const router = createMemoryRouter([{ path: '/', element: <Host /> }])
    render(
      <I18nProvider>
        <RouterProvider router={router} />
      </I18nProvider>
    )
    await user.click(await screen.findByRole('button', { name: '실패 알림' }))
    expect(screen.getByRole('alert')).toHaveTextContent('저장 실패')
    expect(screen.getByRole('alert')).toHaveFocus()
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
      screen.getAllByRole('textbox', { name: /^[1-4]번 보기$/ })
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

    const secondOption = screen.getByRole('textbox', { name: '2번 보기' })
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

describe('question form locale and preserved state', () => {
  afterEach(async () => {
    writeUiLocalePreference('ko')
    await appI18n.changeLanguage('ko')
    document.documentElement.lang = 'ko'
  })

  it.each([
    {
      locale: 'ko' as const,
      heading: '기본 정보',
      question: '문제 문장',
      questionError: '질문을 입력해 주세요.',
      tag: '태그',
      tagError: '태그를 1개 이상 입력해 주세요.'
    },
    {
      locale: 'ja' as const,
      heading: '基本情報',
      question: '問題文',
      questionError: '問題文を入力してください。',
      tag: 'タグ',
      tagError: 'タグを1つ以上入力してください。'
    }
  ])(
    'shows normal and required errors in $locale',
    async ({ locale, heading, question, questionError, tag, tagError }) => {
      expect(writeUiLocalePreference(locale)).toBe(true)
      const user = userEvent.setup()
      const handleSubmit = vi.fn()
      render(renderQuestionForm(handleSubmit))
      await waitFor(() => expect(appI18n.resolvedLanguage).toBe(locale))
      expect(screen.getByRole('heading', { name: heading })).toBeVisible()
      const questionInput = screen.getByRole('textbox', { name: question })
      const tagInput = screen.getByRole('textbox', { name: tag })
      await user.click(screen.getByRole('button', { name: '문제 등록' }))
      expect(await screen.findByText(questionError)).toBeVisible()
      expect(screen.getByText(tagError)).toBeVisible()
      expect(questionInput).toHaveAttribute('aria-invalid', 'true')
      expect(questionInput).toHaveAccessibleDescription(questionError)
      expect(tagInput).toHaveAttribute('aria-invalid', 'true')
      expect(tagInput).toHaveAccessibleDescription(new RegExp(tagError))
      expect(handleSubmit).not.toHaveBeenCalled()
    }
  )

  it.each([
    {
      locale: 'ko' as const,
      tag: '태그',
      error: '입력 형식이나 길이를 확인해 주세요.'
    },
    {
      locale: 'ja' as const,
      tag: 'タグ',
      error: '入力の形式や長さを確認してください。'
    }
  ])(
    'shows the common message in $locale for a contract check without a form key',
    async ({ locale, tag, error }) => {
      const tooManyTags = Array.from({ length: 13 }, (_, i) => `태그${i + 1}`)
      const messages = getIssueMessages({
        ...validFormValues,
        tagsText: tooManyTags.join(', ')
      })
      expect(messages.length).toBeGreaterThan(0)
      expect(
        messages.every((message) => !message.startsWith('editor.form.'))
      ).toBe(true)

      expect(writeUiLocalePreference(locale)).toBe(true)
      const user = userEvent.setup()
      const handleSubmit = vi.fn()
      render(renderQuestionForm(handleSubmit, initialQuestion, true))
      await waitFor(() => expect(appI18n.resolvedLanguage).toBe(locale))
      const tagInput = screen.getByRole('textbox', { name: tag })
      fireEvent.change(tagInput, { target: { value: tooManyTags.join(', ') } })
      await user.click(screen.getByRole('button', { name: '문제 등록' }))
      expect(await screen.findByText(error)).toBeVisible()
      expect(tagInput).toHaveAttribute('aria-invalid', 'true')
      for (const message of messages)
        expect(screen.queryByText(message)).not.toBeInTheDocument()
      expect(handleSubmit).not.toHaveBeenCalled()
    }
  )

  it('localizes a well-formed overlength question without hiding other contract errors', async () => {
    expect(writeUiLocalePreference('ja')).toBe(true)
    const user = userEvent.setup()
    const handleSubmit = vi.fn()
    render(renderQuestionForm(handleSubmit, undefined, true))
    await waitFor(() => expect(appI18n.resolvedLanguage).toBe('ja'))
    const input = screen.getByRole('textbox', { name: '問題文' })
    fireEvent.change(input, { target: { value: 'あ'.repeat(2001) } })
    await user.click(screen.getByRole('button', { name: '문제 등록' }))
    expect(
      await screen.findByText(
        '正規化後のUnicode文字を1〜2000個で入力してください。'
      )
    ).toBeVisible()
    expect(handleSubmit).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: '한국어' }))
    expect(
      await screen.findByText(
        '정규화 후 Unicode 문자 1~2000개로 입력해 주세요.'
      )
    ).toBeVisible()
    expect(screen.getByRole('textbox', { name: '문제 문장' })).toHaveValue(
      'あ'.repeat(2001)
    )
    const invalidMessages = getIssueMessages({
      ...validFormValues,
      questionText: 'あ'.repeat(2001) + '\u0001'
    })
    expect(invalidMessages).not.toContain(
      'editor.form.validation.questionLength'
    )
    expect(invalidMessages).toContain('제어 문자는 허용하지 않습니다.')
  })

  it('updates existing errors when switching locale without losing edit content or revision', async () => {
    expect(writeUiLocalePreference('ko')).toBe(true)
    const user = userEvent.setup()
    const handleSubmit = vi.fn(
      async (
        _input: CreateAdminQuestionRequest | UpdateQuestionVersionRequest
      ) => undefined
    )
    render(renderQuestionForm(handleSubmit, initialQuestion, true))
    const question = screen.getByRole('textbox', { name: '문제 문장' })
    await user.clear(question)
    await user.click(screen.getByRole('button', { name: '문제 등록' }))
    expect(await screen.findByText('질문을 입력해 주세요.')).toBeVisible()
    await user.click(screen.getByRole('button', { name: '日本語' }))
    expect(await screen.findByText('問題文を入力してください。')).toBeVisible()
    expect(screen.queryByText('질문을 입력해 주세요.')).not.toBeInTheDocument()
    const japaneseQuestion = screen.getByRole('textbox', { name: '問題文' })
    expect(japaneseQuestion).toHaveValue('')
    expect(japaneseQuestion).toHaveAccessibleDescription(
      '問題文を入力してください。'
    )
    expect(screen.getByRole('textbox', { name: '選択肢1' })).toHaveValue(
      initialQuestion.question.options[0].text
    )
    expect(screen.getByRole('textbox', { name: 'タグ' })).toHaveValue('문법')
    expect(handleSubmit).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: '한국어' }))
    expect(await screen.findByText('질문을 입력해 주세요.')).toBeVisible()
    await user.type(
      screen.getByRole('textbox', { name: '문제 문장' }),
      '保存前の原文'
    )
    await user.click(screen.getByRole('button', { name: '문제 등록' }))
    await waitFor(() => expect(handleSubmit).toHaveBeenCalledTimes(1))
    expect(handleSubmit.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        questionText: '保存前の原文',
        expectedRowVersion: 1,
        correctOptionId: initialQuestion.adminAnswer.correctOptionId,
        options: initialQuestion.question.options.map((option, index) => ({
          id: option.id,
          ordinal: index + 1,
          text: option.text
        })),
        tagNames: ['문법']
      })
    )
  })
})
