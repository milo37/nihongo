import { QueryClientProvider } from '@tanstack/react-query'
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import type { ReactElement } from 'react'
import type {
  PreviewQuestionVersionResponse,
  UpdateQuestionVersionRequest
} from '@nihongo/contracts/admin/phase7'
import { describe, expect, it, vi } from 'vitest'
import {
  listPhase7AdminQuestions,
  previewPhase7QuestionVersion
} from '@api/phase7/phase7AdminApi'
import { Phase7QuestionEditor } from '@app/admin-question/components/Phase7QuestionEditor'
import { queryClient } from '@libs/queryClient'
import { DEMO_ADMIN_ID } from '@mocks/data/users'
import { mockDatabase } from '@mocks/repository/mockDatabase'

const loadPreview = async (): Promise<PreviewQuestionVersionResponse> => {
  mockDatabase.loginAs('ADMIN', DEMO_ADMIN_ID)
  const list = await listPhase7AdminQuestions({
    page: 1,
    pageSize: 1,
    sort: 'UPDATED_DESC'
  })
  const versionId = list.items[0]?.selectedVersionId
  if (!versionId) throw new Error('Editor preview fixture is unavailable.')
  return await previewPhase7QuestionVersion(versionId)
}

const loadGrammarPreview =
  async (): Promise<PreviewQuestionVersionResponse> => {
    const preview = await loadPreview()
    return {
      ...preview,
      question: {
        ...preview.question,
        level: 'N3',
        options: preview.question.options.map((option, index) => ({
          ...option,
          text: `선택지 ${index + 1}`
        })),
        passage: null,
        questionType: 'GRAMMAR_SELECT',
        subject: 'GRAMMAR'
      }
    }
  }

const renderInDataRouter = (element: ReactElement) => {
  const router = createMemoryRouter(
    [
      { path: '/editor', element },
      { path: '/away', element: <p>다른 화면</p> }
    ],
    { initialEntries: ['/editor'] }
  )
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  return router
}

describe('Phase7QuestionEditor', () => {
  it('keeps the correct option identity while keyboard reordering and resets the dirty baseline after save', async () => {
    const preview = await loadPreview()
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    renderInDataRouter(
      <Phase7QuestionEditor
        expectedRowVersion={7}
        initialPreview={preview}
        isSubmitting={false}
        mode="update"
        submitLabel="초안 저장"
        onSubmit={onSubmit}
      />
    )
    const correctIndex = preview.question.options.findIndex(
      (option) => option.id === preview.adminAnswer.correctOptionId
    )
    if (correctIndex < 0) throw new Error('Correct option is unavailable.')
    const direction = correctIndex === 3 ? -1 : 1
    const expectedOrder = preview.question.options.map((option) => option.id)
    const [moved] = expectedOrder.splice(correctIndex, 1)
    if (!moved) throw new Error('Moved option is unavailable.')
    expectedOrder.splice(correctIndex + direction, 0, moved)

    fireEvent.keyDown(screen.getByLabelText(`${correctIndex + 1}번 보기`), {
      altKey: true,
      key: direction === 1 ? 'ArrowDown' : 'ArrowUp'
    })
    expect(screen.getByText(/정답 ID는 유지됩니다/u)).toBeInTheDocument()

    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: '초안 저장' }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    const request = onSubmit.mock.calls[0]?.[0] as
      | UpdateQuestionVersionRequest
      | undefined
    expect(request).toMatchObject({
      correctOptionId: preview.adminAnswer.correctOptionId,
      expectedRowVersion: 7
    })
    expect(request?.options.map((option) => option.id)).toEqual(expectedOrder)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '초안 저장' })).toBeDisabled()
    )
  })

  it('retains an unsaved local draft when navigation is blocked', async () => {
    const preview = await loadPreview()
    const user = userEvent.setup()
    const router = renderInDataRouter(
      <Phase7QuestionEditor
        expectedRowVersion={1}
        initialPreview={preview}
        isSubmitting={false}
        mode="update"
        submitLabel="초안 저장"
        onSubmit={vi.fn().mockResolvedValue(undefined)}
      />
    )
    const questionText = screen.getByLabelText('문제 문장')
    await user.type(questionText, ' 로컬 초안')

    await act(async () => {
      await router.navigate('/away')
    })
    expect(
      screen.getByRole('dialog', {
        name: '저장하지 않은 변경사항이 있습니다'
      })
    ).toBeVisible()
    expect(questionText).toHaveValue(
      `${preview.question.questionText} 로컬 초안`
    )

    await user.click(screen.getByRole('button', { name: '계속 편집' }))
    expect(screen.queryByText('다른 화면')).not.toBeInTheDocument()

    await act(async () => {
      await router.navigate('/away')
    })
    await user.click(
      screen.getByRole('button', { name: '변경사항 버리고 이동' })
    )
    expect(await screen.findByText('다른 화면')).toBeInTheDocument()
  })

  it('keeps the draft dirty when the save mutation rejects', async () => {
    const preview = await loadPreview()
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockRejectedValue(new Error('rowVersion conflict'))
    renderInDataRouter(
      <Phase7QuestionEditor
        expectedRowVersion={1}
        initialPreview={preview}
        isSubmitting={false}
        mode="update"
        submitLabel="초안 저장"
        onSubmit={onSubmit}
      />
    )
    const draft = `${preview.question.questionText} 로컬 충돌 초안`
    await user.clear(screen.getByLabelText('문제 문장'))
    await user.type(screen.getByLabelText('문제 문장'), draft)

    await user.click(screen.getByRole('button', { name: '초안 저장' }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(screen.getByLabelText('문제 문장')).toHaveValue(draft)
    expect(screen.getByRole('button', { name: '초안 저장' })).toBeEnabled()
  })

  it('selects only server taxonomy tags through keyboard listbox interaction', async () => {
    mockDatabase.loginAs('ADMIN', DEMO_ADMIN_ID)
    const user = userEvent.setup()
    renderInDataRouter(
      <Phase7QuestionEditor
        isSubmitting={false}
        mode="create"
        submitLabel="문제 만들기"
        onSubmit={vi.fn().mockResolvedValue(undefined)}
      />
    )
    const search = screen.getByRole('combobox', {
      name: '등록된 태그 검색'
    })
    await user.type(search, '한자')
    const listbox = await screen.findByRole('listbox', {
      name: '등록된 태그 검색 결과'
    })
    const suggestions = await within(listbox).findAllByRole('option')
    const selectedLabel = suggestions[0]?.textContent
    if (!selectedLabel) throw new Error('Tag suggestion is unavailable.')

    expect(search).toHaveAttribute('aria-controls', listbox.id)
    expect(suggestions[0]).toHaveAttribute('tabindex', '-1')

    await user.keyboard('{ArrowDown}')
    expect(suggestions[0]).toHaveClass('ui-active-option')
    await user.keyboard('{Enter}')

    expect(
      screen.getByRole('button', { name: `${selectedLabel} 태그 제거` })
    ).toBeVisible()
    expect(search).toHaveValue('')
    expect(search).not.toHaveAttribute('aria-controls')
  })

  it('keeps a dirty draft mounted when an overlong normalized tag query is pasted', async () => {
    const preview = await loadPreview()
    renderInDataRouter(
      <Phase7QuestionEditor
        expectedRowVersion={1}
        initialPreview={preview}
        isSubmitting={false}
        mode="update"
        submitLabel="초안 저장"
        onSubmit={vi.fn().mockResolvedValue(undefined)}
      />
    )
    const localDraft = `${preview.question.questionText} 보존할 초안`
    fireEvent.change(screen.getByLabelText('문제 문장'), {
      target: { value: localDraft }
    })
    fireEvent.change(
      screen.getByRole('combobox', { name: '등록된 태그 검색' }),
      {
        target: { value: '가'.repeat(101) }
      }
    )

    expect(screen.getByLabelText('문제 문장')).toHaveValue(localDraft)
    expect(
      screen.getByText('태그 검색어는 정규화 후 100자 이하여야 합니다.')
    ).toBeVisible()
    expect(screen.getByRole('button', { name: '초안 저장' })).toBeEnabled()
  })

  it('blocks normalized duplicate options, focuses the duplicate, and preserves every input', async () => {
    const preview = await loadGrammarPreview()
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    renderInDataRouter(
      <Phase7QuestionEditor
        expectedRowVersion={1}
        initialPreview={preview}
        isSubmitting={false}
        mode="update"
        submitLabel="초안 저장"
        onSubmit={onSubmit}
      />
    )
    const firstOption = screen.getByLabelText('1번 보기')
    const secondOption = screen.getByLabelText('2번 보기')
    const thirdOption = screen.getByLabelText('3번 보기')
    const fourthOption = screen.getByLabelText('4번 보기')
    fireEvent.change(firstOption, { target: { value: 'Ａ　Ｂ' } })
    fireEvent.change(secondOption, { target: { value: 'A  B' } })

    await user.click(screen.getByRole('button', { name: '초안 저장' }))

    await waitFor(() => expect(secondOption).toHaveFocus())
    expect(secondOption).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('이 입력값을 확인해 주세요.')).toBeVisible()
    expect(onSubmit).not.toHaveBeenCalled()
    expect(firstOption).toHaveValue('Ａ　Ｂ')
    expect(secondOption).toHaveValue('A  B')
    expect(thirdOption).toHaveValue('선택지 3')
    expect(fourthOption).toHaveValue('선택지 4')
  })

  it('enforces passage applicability without losing the draft and accepts valid grammar and reading states', async () => {
    const preview = await loadGrammarPreview()
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    renderInDataRouter(
      <Phase7QuestionEditor
        expectedRowVersion={1}
        initialPreview={preview}
        isSubmitting={false}
        mode="update"
        submitLabel="초안 저장"
        onSubmit={onSubmit}
      />
    )
    const passage = screen.getByLabelText('지문')
    const questionType = screen.getByLabelText('문제 유형')
    const subject = screen.getByLabelText('과목')
    fireEvent.change(passage, { target: { value: '보존할 문법 지문' } })

    await user.click(screen.getByRole('button', { name: '초안 저장' }))

    await waitFor(() => expect(passage).toHaveFocus())
    expect(passage).toHaveValue('보존할 문법 지문')
    expect(onSubmit).not.toHaveBeenCalled()

    await user.selectOptions(questionType, 'TEXT_GRAMMAR')
    await user.click(screen.getByRole('button', { name: '초안 저장' }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
      passage: '보존할 문법 지문',
      questionType: 'TEXT_GRAMMAR',
      subject: 'GRAMMAR'
    })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '초안 저장' })).toBeDisabled()
    )

    await user.selectOptions(subject, 'READING')
    await user.selectOptions(questionType, 'SHORT_READING')
    fireEvent.change(passage, { target: { value: '' } })
    await user.click(screen.getByRole('button', { name: '초안 저장' }))

    await waitFor(() => expect(passage).toHaveFocus())
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(passage).toHaveValue('')

    fireEvent.change(passage, { target: { value: '보존할 독해 지문' } })
    await user.click(screen.getByRole('button', { name: '초안 저장' }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2))
    expect(onSubmit.mock.calls[1]?.[0]).toMatchObject({
      level: 'N3',
      passage: '보존할 독해 지문',
      questionType: 'SHORT_READING',
      subject: 'READING'
    })
  })
})
