import '@testing-library/jest-dom/vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import type { ReactElement } from 'react'
import { I18nProvider } from '@nihongo/browser/provider/I18nProvider'
import type { QuestionSubject } from '@nihongo/browser/common/types/domain'
import * as tagApi from '@api/admin-tag/listAdminTags/index'
import type { AdminTagListItem } from '@api/admin-tag/listAdminTags/schema'
import type { QuestionFormValues } from '@app/admin-question/components/questionFormSchema'
import { QuestionTagPicker } from '@app/admin-question/components/QuestionTagPicker'

type PickedTags = QuestionFormValues['tags']

const tag = (
  label: string,
  subject: QuestionSubject | null = 'GRAMMAR'
): AdminTagListItem => ({
  id: `tag-${label}`,
  label,
  normalizedName: label.toLowerCase(),
  subject
})

const grammarTags = [tag('조사'), tag('접속 표현'), tag('경어')]

const Host = ({
  initial = [],
  subject = 'GRAMMAR'
}: {
  initial?: PickedTags
  subject?: QuestionSubject
}): ReactElement => {
  const [value, setValue] = useState<PickedTags>(initial)
  return (
    <QuestionTagPicker value={value} onChange={setValue} subject={subject} />
  )
}

const renderPicker = (props: Parameters<typeof Host>[0] = {}) =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <I18nProvider>
        <Host {...props} />
      </I18nProvider>
    </QueryClientProvider>
  )

const search = (): HTMLElement => screen.getByRole('combobox', { name: '태그' })

describe('QuestionTagPicker', () => {
  let listTags: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    listTags = vi
      .spyOn(tagApi, 'listAdminTags')
      .mockResolvedValue({ items: grammarTags })
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows the subject’s tags on focus and picks one by click', async () => {
    const user = userEvent.setup()
    renderPicker()

    await user.click(search())
    const list = await screen.findByRole('listbox', { name: '태그' })
    expect(listTags).toHaveBeenCalledWith({ subject: 'GRAMMAR', limit: 50 })
    expect(within(list).getAllByRole('option')).toHaveLength(3)
    expect(screen.getByText('태그 3개')).toBeInTheDocument()

    await user.click(within(list).getByRole('option', { name: '조사' }))
    expect(screen.getByText('조사')).toBeVisible()
    expect(screen.getByText('1/2')).toBeVisible()
    expect(search()).toHaveFocus()
    expect(search()).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('조사 태그를 추가했습니다')).toBeInTheDocument()

    await user.keyboard('{ArrowDown}')
    const reopened = await screen.findByRole('listbox')
    expect(
      within(reopened).queryByRole('option', { name: '조사' })
    ).not.toBeInTheDocument()
  })

  it('searches by the normalized name after typing stops', async () => {
    const user = userEvent.setup()
    listTags.mockResolvedValue({ items: [] })
    renderPicker()

    await user.type(search(), '  ABC ')
    expect(
      await screen.findByText(
        '‘ABC’로 시작하는 태그가 없습니다. 태그는 여기서 새로 만들 수 없습니다.'
      )
    ).toBeVisible()
    expect(listTags).toHaveBeenLastCalledWith({
      subject: 'GRAMMAR',
      q: 'abc',
      limit: 50
    })
    expect(listTags).not.toHaveBeenCalledWith(
      expect.objectContaining({ q: 'a' })
    )
  })

  it('moves with arrow keys, picks with Enter and closes with Escape', async () => {
    const user = userEvent.setup()
    renderPicker()

    await user.click(search())
    await screen.findByRole('listbox')
    await user.keyboard('{ArrowDown}')
    const active = screen.getByRole('option', { name: '접속 표현' })
    expect(active).toHaveAttribute('aria-selected', 'true')
    expect(search()).toHaveAttribute('aria-activedescendant', active.id)

    await user.keyboard('{Enter}')
    expect(screen.getByText('접속 표현')).toBeVisible()

    await user.type(search(), '경')
    await screen.findByRole('listbox')
    await user.keyboard('{Escape}')
    expect(search()).toHaveAttribute('aria-expanded', 'false')
    expect(search()).toHaveValue('경')
    await user.keyboard('{Escape}')
    expect(search()).toHaveValue('')
  })

  it('shows a retry when the tag list fails', async () => {
    const user = userEvent.setup()
    listTags.mockRejectedValueOnce(new Error('network'))
    renderPicker()

    await user.click(search())
    expect(
      await screen.findByText('태그 목록을 불러오지 못했습니다.')
    ).toBeVisible()
    await user.click(screen.getByRole('button', { name: '다시 시도' }))
    expect(await screen.findAllByRole('option')).toHaveLength(3)
    expect(search()).toHaveFocus()
  })

  it('keeps the list open when Tab moves to the retry button', async () => {
    const user = userEvent.setup()
    listTags.mockRejectedValueOnce(new Error('network'))
    renderPicker()

    await user.click(search())
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '태그 목록을 불러오지 못했습니다.'
    )
    await user.tab()
    const retry = screen.getByRole('button', { name: '다시 시도' })
    expect(retry).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(await screen.findAllByRole('option')).toHaveLength(3)
    expect(search()).toHaveFocus()
  })

  it('moves focus to the new tag’s remove button when the second tag fills the field', async () => {
    const user = userEvent.setup()
    renderPicker({ initial: [{ label: '경어', subject: 'GRAMMAR' }] })

    await user.click(search())
    await user.click(await screen.findByRole('option', { name: '조사' }))
    expect(search()).toBeDisabled()
    expect(
      screen.getByRole('button', { name: '조사 태그 지우기' })
    ).toHaveFocus()
  })

  it('says there may be more when the whole page came back', async () => {
    const user = userEvent.setup()
    listTags.mockResolvedValue({
      items: Array.from({ length: 50 }, (_, index) => tag(`태그${index}`))
    })
    renderPicker()

    await user.click(search())
    expect(
      await screen.findByText('더 있을 수 있어요. 이름으로 검색해 주세요.')
    ).toBeVisible()
  })

  it('disables the search at two tags', () => {
    renderPicker({
      initial: [
        { label: '조사', subject: 'GRAMMAR' },
        { label: '경어', subject: 'GRAMMAR' }
      ]
    })

    expect(search()).toBeDisabled()
    expect(search()).toHaveAccessibleDescription(
      '태그는 2개까지 고를 수 있습니다. 바꾸려면 하나를 지워 주세요.'
    )
  })

  it('keeps an over-limit question’s tags removable and moves focus after removal', async () => {
    const user = userEvent.setup()
    renderPicker({
      initial: [
        { label: '이유', subject: null },
        { label: '조건', subject: null },
        { label: '추측', subject: null }
      ]
    })

    expect(search()).toBeDisabled()
    expect(screen.getByText('3/2')).toBeVisible()
    expect(
      screen.getByText(
        '이 문제에는 태그가 3개 있습니다. 새 기준은 2개까지라 추가할 수 없습니다. 필요 없는 태그를 지워 주세요.'
      )
    ).toBeVisible()

    await user.click(screen.getByRole('button', { name: '이유 태그 지우기' }))
    expect(
      screen.getByRole('button', { name: '조건 태그 지우기' })
    ).toHaveFocus()
    expect(screen.getByText('이유 태그를 지웠습니다')).toBeInTheDocument()
    expect(search()).toBeDisabled()

    await user.click(screen.getByRole('button', { name: '추측 태그 지우기' }))
    expect(
      screen.getByRole('button', { name: '조건 태그 지우기' })
    ).toHaveFocus()
    expect(search()).toBeEnabled()

    await user.click(screen.getByRole('button', { name: '조건 태그 지우기' }))
    expect(search()).toHaveFocus()
  })

  it('warns about a picked tag from another subject but not about unknown ones', () => {
    renderPicker({
      subject: 'VOCABULARY',
      initial: [
        { label: '조사', subject: 'GRAMMAR' },
        { label: '이유', subject: null }
      ]
    })

    expect(
      screen.getByText(
        '문제 과목과 맞지 않는 태그가 있습니다. 지우고 다시 골라 주세요.'
      )
    ).toBeVisible()
    expect(search()).toHaveAttribute('aria-invalid', 'true')
    expect(
      screen.getByRole('button', { name: '조사 태그 지우기 (과목 불일치)' })
    ).toBeVisible()
    expect(
      screen.getByRole('button', { name: '이유 태그 지우기' })
    ).toBeVisible()
  })

  it('treats a blank search as the whole subject list', async () => {
    const user = userEvent.setup()
    renderPicker()

    await user.type(search(), '　 ')
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(3))
    expect(listTags).not.toHaveBeenCalledWith(
      expect.objectContaining({ q: expect.anything() })
    )
  })
})
