import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { validateQuestionImportRequestSchema } from '@nihongo/contracts/admin/phase7'
import { AdminQuestionImportPage } from '@app/admin-import/page'
import { DEMO_ADMIN_ID } from '@mocks/data/users'
import { mockDatabase } from '@mocks/repository/mockDatabase'
import { useAppStore } from '@store/index'
import { mockServer } from '@/test/server'

const importRequest = validateQuestionImportRequestSchema.parse({
  items: [
    {
      clientItemId: 'slice6-import-page-test',
      content: {
        level: 'N5',
        subject: 'GRAMMAR',
        questionType: 'GRAMMAR_SELECT',
        difficulty: 'EASY',
        questionText: '朝は 七時（　）起きます。 import race fixture',
        passage: null,
        explanationKo: '구체적인 시각에는 조사 「に」를 사용합니다.',
        explanationJa: null,
        tagNames: ['조사'],
        options: [
          { clientOptionKey: 'option-1', text: 'に' },
          { clientOptionKey: 'option-2', text: 'で' },
          { clientOptionKey: 'option-3', text: 'を' },
          { clientOptionKey: 'option-4', text: 'が' }
        ],
        correctOptionKey: 'option-1'
      }
    }
  ]
})

const bytes = new TextEncoder().encode(JSON.stringify(importRequest))

const createFile = (
  name: string,
  contents: Uint8Array,
  read: () => Promise<ArrayBuffer> = async () =>
    contents.buffer.slice(
      contents.byteOffset,
      contents.byteOffset + contents.byteLength
    ) as ArrayBuffer
): File =>
  ({
    arrayBuffer: read,
    name,
    size: contents.byteLength,
    type: 'application/json'
  }) as File

const renderPage = () => {
  const client = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false }
    }
  })
  const rendered = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AdminQuestionImportPage />
      </MemoryRouter>
    </QueryClientProvider>
  )
  return { client, unmount: rendered.unmount }
}

describe('AdminQuestionImportPage', () => {
  it('discards a stale slow file read after a newer selection finishes', async () => {
    let releaseSlow: ((value: ArrayBuffer) => void) | undefined
    const slowRead = new Promise<ArrayBuffer>((resolve) => {
      releaseSlow = resolve
    })
    const slow = createFile('slow-valid.json', bytes, () => slowRead)
    const invalidBytes = new TextEncoder().encode('{invalid')
    const fast = createFile('fast-invalid.json', invalidBytes)
    const { client, unmount } = renderPage()
    const input = screen.getByLabelText('JSON 파일')

    fireEvent.change(input, { target: { files: [slow] } })
    fireEvent.change(input, { target: { files: [fast] } })
    expect(await screen.findByText('선택: fast-invalid.json')).toBeVisible()
    expect(
      await screen.findByText(/canonical import request 형식/u)
    ).toBeVisible()
    expect(
      screen.getByRole('button', { name: '쓰기 없이 검증' })
    ).toBeDisabled()

    await act(async () => {
      releaseSlow?.(
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength
        ) as ArrayBuffer
      )
      await slowRead
    })
    expect(screen.getByText('선택: fast-invalid.json')).toBeVisible()
    expect(screen.getByText(/canonical import request 형식/u)).toBeVisible()
    expect(
      screen.getByRole('button', { name: '쓰기 없이 검증' })
    ).toBeDisabled()

    unmount()
    client.clear()
  })

  it('locks file and action controls while an apply request is pending', async () => {
    const admin = mockDatabase.loginAs('ADMIN', DEMO_ADMIN_ID)
    useAppStore.getState().setCurrentUser(admin)
    let releaseApply: (() => void) | undefined
    const applyGate = new Promise<void>((resolve) => {
      releaseApply = resolve
    })
    mockServer.use(
      http.post('*/api/v1/admin/questions/import-application', async () => {
        await applyGate
        return HttpResponse.json(
          { error: { code: 'SERVICE_UNAVAILABLE', message: 'test gate' } },
          { status: 503 }
        )
      })
    )
    const user = userEvent.setup()
    const { client, unmount } = renderPage()
    const input = screen.getByLabelText('JSON 파일')
    fireEvent.change(input, {
      target: { files: [createFile('valid.json', bytes)] }
    })
    const validateButton = screen.getByRole('button', {
      name: '쓰기 없이 검증'
    })
    await waitFor(() => expect(validateButton).toBeEnabled())
    await user.click(validateButton)
    const applyButton = await screen.findByRole('button', {
      name: '동일 검증 결과 원자 적용'
    })
    await user.click(applyButton)

    await waitFor(() => expect(input).toBeDisabled())
    expect(validateButton).toBeDisabled()
    expect(applyButton).toBeDisabled()

    await act(async () => {
      releaseApply?.()
      await applyGate
    })
    await waitFor(() => expect(input).toBeEnabled())
    unmount()
    client.clear()
  })
})
