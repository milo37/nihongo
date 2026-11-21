import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  QueryClient,
  QueryClientProvider,
  onlineManager
} from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import type { AdminPassageGroup } from '@nihongo/contracts/admin/content-operations'
import { I18nProvider } from '@nihongo/browser/provider/I18nProvider'
import { appI18n } from '@nihongo/browser/i18n/config'
import { writeUiLocalePreference } from '@nihongo/browser/libs/localeStorage'
import { useAppStore } from '@nihongo/browser/store/index'
import { queryClient } from '@nihongo/browser/libs/queryClient'
import { subscribeApiError } from '@nihongo/browser/libs/errorBus'
import * as api from '@nihongo/browser/api/content-operations/requestContentOperation'
import {
  SharedPassageGroup,
  isSharedPassage
} from '@app/admin-question/components/SharedPassageGroup'
import { actor } from '@app/admin-question/test/workflowFixture'
import { useEditReadingPassage } from '@app/admin-question/hooks/useEditReadingPassage'

const t = appI18n.getFixedT('ko', 'admin')
const Q1 = '10000000-0000-4000-8000-0000000000a1'
const Q2 = '10000000-0000-4000-8000-0000000000a2'
const PASSAGE = '10000000-0000-4000-8000-0000000000b1'

const item = (questionId: string, passageOrder: number) => ({
  questionId,
  questionRowVersion: passageOrder + 3,
  passageOrder,
  level: 'N3' as const,
  questionType: 'MEDIUM_READING' as const,
  questionTextPreview: `問${passageOrder}`,
  openVersionId: null,
  openVersionStatus: null
})

const group = (
  overrides: Partial<AdminPassageGroup> = {}
): AdminPassageGroup => ({
  passageId: PASSAGE,
  questions: [item(Q1, 1), item(Q2, 2)],
  editing: false,
  ...overrides
})

let client: QueryClient
// Owns the edit like the preview panel; `shown` false is the preview
// reloading a newly selected version, which unmounts the block.
const Panel = ({
  value,
  shown = true
}: {
  value: AdminPassageGroup
  shown?: boolean
}) => {
  const edit = useEditReadingPassage()
  return shown ? (
    <SharedPassageGroup
      edit={edit}
      group={value}
      isOffline={false}
      passage="古い文章。"
      questionId={Q1}
    />
  ) : null
}
const tree = (value: AdminPassageGroup, shown = true) => (
  <QueryClientProvider client={client}>
    <I18nProvider>
      <MemoryRouter>
        <Panel value={value} shown={shown} />
      </MemoryRouter>
    </I18nProvider>
  </QueryClientProvider>
)
const view = (value: AdminPassageGroup) => render(tree(value))

describe('shared passage group (#1196)', () => {
  beforeEach(() => {
    client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
    })
    writeUiLocalePreference('ko')
    onlineManager.setOnline(true)
    useAppStore.getState().setCurrentUser(actor())
  })

  it('counts as shared only with two or more questions', () => {
    expect(isSharedPassage(null)).toBe(false)
    expect(isSharedPassage(undefined)).toBe(false)
    expect(isSharedPassage(group({ questions: [item(Q1, 1)] }))).toBe(false)
    expect(isSharedPassage(group())).toBe(true)
  })

  it('edits the passage for every question in the group', async () => {
    const send = vi
      .spyOn(api, 'requestContentOperation')
      .mockResolvedValue({} as never)
    const { rerender } = view(group())
    expect(
      await screen.findByText(
        t('questionDetail.sharedPassage.shared', { count: 2 })
      )
    ).toBeInTheDocument()
    await userEvent.click(
      screen.getByRole('button', {
        name: t('questionDetail.sharedPassage.edit')
      })
    )
    const box = screen.getByRole('textbox', {
      name: t('questionDetail.sharedPassage.editLabel')
    })
    expect(box).toHaveValue('古い文章。')
    await userEvent.clear(box)
    await userEvent.type(box, '新しい文章。')
    await userEvent.click(
      screen.getByRole('button', {
        name: t('questionDetail.sharedPassage.save', { count: 2 })
      })
    )
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        operation: 'editReadingPassage',
        params: { passageId: PASSAGE },
        query: {},
        body: {
          text: '新しい文章。',
          expectedQuestions: [
            { questionId: Q1, expectedQuestionRowVersion: 4 },
            { questionId: Q2, expectedQuestionRowVersion: 5 }
          ]
        }
      })
    )
    expect(
      await screen.findByText(
        t('questionDetail.sharedPassage.saved', { count: 2 })
      )
    ).toBeInTheDocument()
    // The reload selects this question's new draft and remounts the block.
    rerender(tree(group(), false))
    rerender(tree(group({ editing: true })))
    expect(
      screen.getByText(t('questionDetail.sharedPassage.saved', { count: 2 }))
    ).toBeInTheDocument()
  })

  it('lists the questions with an open version instead of the edit button', async () => {
    view(
      group({
        questions: [
          item(Q1, 1),
          {
            ...item(Q2, 2),
            openVersionId: '10000000-0000-4000-8000-0000000000c2',
            openVersionStatus: 'IN_REVIEW'
          }
        ]
      })
    )
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(t('questionDetail.sharedPassage.blocked'))
    expect(alert).toHaveTextContent(t('enums.versionStatuses.IN_REVIEW'))
    expect(
      screen.queryByRole('button', {
        name: t('questionDetail.sharedPassage.edit')
      })
    ).not.toBeInTheDocument()
  })

  it('shows the questions the server refused', async () => {
    vi.spyOn(api, 'requestContentOperation').mockRejectedValue({
      code: 'VALIDATION_ERROR',
      fieldErrors: { expectedQuestions: [Q2] }
    })
    view(group())
    await userEvent.click(
      await screen.findByRole('button', {
        name: t('questionDetail.sharedPassage.edit')
      })
    )
    await userEvent.type(
      screen.getByRole('textbox', {
        name: t('questionDetail.sharedPassage.editLabel')
      }),
      '追加'
    )
    await userEvent.click(
      screen.getByRole('button', {
        name: t('questionDetail.sharedPassage.save', { count: 2 })
      })
    )
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(t('questionDetail.sharedPassage.blocked'))
    expect(alert).toHaveTextContent('N3')
  })

  it('says the group moves together while a passage edit is open', async () => {
    view(group({ editing: true }))
    expect(
      await screen.findByText(
        t('questionDetail.sharedPassage.editing', { count: 2 })
      )
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', {
        name: t('questionDetail.sharedPassage.edit')
      })
    ).not.toBeInTheDocument()
  })

  it('keeps the conflict message after the reload opens another edit', async () => {
    vi.spyOn(api, 'requestContentOperation').mockRejectedValue({
      code: 'VERSION_CONFLICT'
    })
    const { rerender } = view(group())
    await userEvent.click(
      await screen.findByRole('button', {
        name: t('questionDetail.sharedPassage.edit')
      })
    )
    await userEvent.type(
      screen.getByRole('textbox', {
        name: t('questionDetail.sharedPassage.editLabel')
      }),
      '追加'
    )
    await userEvent.click(
      screen.getByRole('button', {
        name: t('questionDetail.sharedPassage.save', { count: 2 })
      })
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      t('questionDetail.sharedPassage.conflict')
    )
    // The reload selects the new draft: the block unmounts while its
    // preview loads, then shows the other admin's open edit group.
    rerender(tree(group(), false))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    rerender(tree(group({ editing: true })))
    expect(screen.getByRole('alert')).toHaveTextContent(
      t('questionDetail.sharedPassage.conflict')
    )
  })

  it('shows a refusal only in the block, gone after the next save', async () => {
    // The app client, whose mutation cache feeds the shared error banner.
    client = queryClient
    const banner: unknown[] = []
    const unsubscribe = subscribeApiError((error) => banner.push(error))
    vi.spyOn(api, 'requestContentOperation')
      .mockRejectedValueOnce({
        code: 'DUPLICATE_QUESTION_CONTENT',
        message: 'unchanged'
      })
      .mockResolvedValueOnce({} as never)
    view(group())
    await userEvent.click(
      await screen.findByRole('button', {
        name: t('questionDetail.sharedPassage.edit')
      })
    )
    const save = screen.getByRole('button', {
      name: t('questionDetail.sharedPassage.save', { count: 2 })
    })
    await userEvent.click(save)
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    await userEvent.type(
      screen.getByRole('textbox', {
        name: t('questionDetail.sharedPassage.editLabel')
      }),
      '追加'
    )
    await userEvent.click(save)
    expect(await screen.findByRole('status')).toHaveTextContent(
      t('questionDetail.sharedPassage.saved', { count: 2 })
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(banner).toEqual([])
    unsubscribe()
    queryClient.clear()
  })
})
