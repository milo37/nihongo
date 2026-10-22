import {
  onlineManager,
  QueryClient,
  QueryClientProvider
} from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactElement, ReactNode } from 'react'
import { useBookmarkMutationActivity } from '@app/bookmark/hooks/useBookmarkMutationActivity'
import { useCreateBookmark } from '@app/bookmark/hooks/useCreateBookmark'
import { useDeleteBookmark } from '@app/bookmark/hooks/useDeleteBookmark'
import { useListBookmarks } from '@app/bookmark/hooks/useListBookmarks'
import { bookmarkQueries } from '@app/bookmark/queries/bookmarkQueries'
import { commitCanonicalAuth } from '@app/login/authSession'
import { toContractBookmarkSummary } from '@mocks/adapters/bookmarkContractAdapter'
import { getContractQuestionId } from '@mocks/adapters/questionContractAdapter'
import { demoUsers } from '@mocks/data/users'
import { mockDatabase } from '@mocks/repository/mockDatabase'
import { useAppStore } from '@store/index'
import { mockServer } from '@/test/server'

interface Deferred {
  promise: Promise<void>
  release: () => void
}

const createDeferred = (): Deferred => {
  let release: (() => void) | undefined
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release: () => release?.() }
}

describe('useBookmarkMutationActivity', () => {
  it('겹친 문항 mutation을 마지막 observer 변수와 무관하게 각각 잠근다', async () => {
    const user = mockDatabase.loginAs('USER')
    const createQuestionId = getContractQuestionId('n5-vocabulary-01')
    const deleteQuestionId = getContractQuestionId('n5-vocabulary-02')
    const optimisticBookmark = toContractBookmarkSummary(
      mockDatabase.createCanonicalBookmark(
        user.id,
        mockDatabase.resolveCanonicalQuestionId(createQuestionId) ?? ''
      ).source
    )
    const createGate = createDeferred()
    const deleteGate = createDeferred()
    mockServer.use(
      http.put('*/api/v1/bookmarks/:questionId', async () => {
        await createGate.promise
        return HttpResponse.json(optimisticBookmark, {
          status: 200,
          headers: {
            'Cache-Control': 'private, no-store',
            Location: `/api/v1/bookmarks/${createQuestionId}`,
            'X-Request-Id': crypto.randomUUID()
          }
        })
      }),
      http.delete('*/api/v1/bookmarks/:questionId', async () => {
        await deleteGate.promise
        return new HttpResponse(null, {
          status: 204,
          headers: {
            'Cache-Control': 'private, no-store',
            'X-Request-Id': crypto.randomUUID()
          }
        })
      })
    )
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
    })
    const wrapper = ({ children }: { children: ReactNode }): ReactElement => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const hook = renderHook(
      () => ({
        activity: useBookmarkMutationActivity(),
        create: useCreateBookmark(),
        delete: useDeleteBookmark()
      }),
      { wrapper }
    )

    act(() => {
      hook.result.current.create.mutate({
        questionId: createQuestionId,
        optimisticBookmark
      })
      hook.result.current.delete.mutate(deleteQuestionId)
    })

    await waitFor(() => {
      const mutations = client.getMutationCache().getAll()
      expect(mutations).toHaveLength(2)
      expect(
        client.getMutationCache().findAll({
          mutationKey: ['bookmark'],
          status: 'pending'
        })
      ).toHaveLength(2)
      expect(
        mutations.map((mutation) => ({
          key: mutation.options.mutationKey,
          status: mutation.state.status,
          variables: mutation.state.variables
        }))
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            key: ['bookmark', 'create'],
            status: 'pending',
            variables: expect.objectContaining({ questionId: createQuestionId })
          }),
          expect.objectContaining({
            key: ['bookmark', 'delete'],
            status: 'pending',
            variables: expect.objectContaining({ questionId: deleteQuestionId })
          })
        ])
      )
      expect(hook.result.current.activity.pendingQuestionIds).toEqual(
        new Set([createQuestionId, deleteQuestionId])
      )
    })

    deleteGate.release()
    await waitFor(() =>
      expect(hook.result.current.activity.pendingQuestionIds).toEqual(
        new Set([createQuestionId])
      )
    )

    createGate.release()
    await waitFor(() =>
      expect(hook.result.current.activity.pendingQuestionIds.size).toBe(0)
    )
    client.clear()
  })

  it('account switch는 offline paused mutation과 optimistic owner cache를 제거한다', async () => {
    const user = mockDatabase.loginAs('USER')
    const admin = demoUsers.find(({ role }) => role === 'ADMIN')
    if (!admin) {
      throw new Error('ADMIN auth transition fixture가 필요합니다.')
    }
    useAppStore.getState().setCurrentUser(user)
    const questionId = getContractQuestionId('n5-vocabulary-01')
    const optimisticBookmark = toContractBookmarkSummary(
      mockDatabase.createCanonicalBookmark(
        user.id,
        mockDatabase.resolveCanonicalQuestionId(questionId) ?? ''
      ).source
    )
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
    })
    const listKey = bookmarkQueries.list().queryKey
    client.setQueryData(listKey, {
      items: [],
      page: 1,
      pageSize: 20,
      total: 0
    })
    const wrapper = ({ children }: { children: ReactNode }): ReactElement => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const hook = renderHook(
      () => ({
        activity: useBookmarkMutationActivity(),
        create: useCreateBookmark()
      }),
      { wrapper }
    )

    act(() => onlineManager.setOnline(false))
    act(() => {
      hook.result.current.create.mutate({
        questionId,
        optimisticBookmark
      })
    })
    await waitFor(() => {
      expect(client.getMutationCache().getAll()).toHaveLength(1)
      expect(hook.result.current.activity.isPaused).toBe(true)
      expect(
        hook.result.current.activity.pendingQuestionIds.has(questionId)
      ).toBe(true)
    })

    await act(async () => {
      await commitCanonicalAuth(client, admin, {
        forceClear: true,
        forcePracticeReset: true
      })
    })

    await waitFor(() => {
      expect(client.getMutationCache().getAll()).toHaveLength(0)
      expect(hook.result.current.activity.pendingQuestionIds.size).toBe(0)
    })
    expect(client.getQueryData(listKey)).toBeUndefined()
    act(() => onlineManager.setOnline(true))
    client.clear()
  })

  it('offline paused create는 reconnect 뒤 한 번 전송되고 canonical cache로 정착한다', async () => {
    const user = mockDatabase.loginAs('USER')
    const questionId = getContractQuestionId('n5-vocabulary-01')
    const canonicalBookmark = toContractBookmarkSummary(
      mockDatabase.createCanonicalBookmark(
        user.id,
        mockDatabase.resolveCanonicalQuestionId(questionId) ?? ''
      ).source
    )
    let putRequestCount = 0
    mockServer.use(
      http.put('*/api/v1/bookmarks/:questionId', () => {
        putRequestCount += 1
        return HttpResponse.json(canonicalBookmark, {
          status: 201,
          headers: {
            'Cache-Control': 'private, no-store',
            Location: `/api/v1/bookmarks/${questionId}`,
            'X-Request-Id': crypto.randomUUID()
          }
        })
      })
    )
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
    })
    const listKey = bookmarkQueries.list().queryKey
    client.setQueryData(listKey, {
      items: [],
      page: 1,
      pageSize: 20,
      total: 0
    })
    const wrapper = ({ children }: { children: ReactNode }): ReactElement => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )

    act(() => onlineManager.setOnline(false))
    const hook = renderHook(
      () => ({
        activity: useBookmarkMutationActivity(),
        create: useCreateBookmark()
      }),
      { wrapper }
    )
    act(() => {
      hook.result.current.create.mutate({
        optimisticBookmark: canonicalBookmark,
        questionId
      })
    })

    await waitFor(() => {
      expect(putRequestCount).toBe(0)
      expect(hook.result.current.activity.isPaused).toBe(true)
      expect(hook.result.current.activity.pendingQuestionIds).toEqual(
        new Set([questionId])
      )
      expect(client.getQueryData(listKey)).toMatchObject({
        items: [canonicalBookmark],
        total: 1
      })
    })

    act(() => onlineManager.setOnline(true))
    await waitFor(() => {
      expect(putRequestCount).toBe(1)
      expect(hook.result.current.create.isSuccess).toBe(true)
      expect(hook.result.current.activity.isPaused).toBe(false)
      expect(hook.result.current.activity.pendingQuestionIds.size).toBe(0)
      expect(client.getQueryData(listKey)).toMatchObject({
        items: [canonicalBookmark],
        total: 1
      })
    })
    client.clear()
  })

  it('optimistic summary가 없는 create 실패는 기존 cache를 변경하지 않는다', async () => {
    const questionId = getContractQuestionId('n5-vocabulary-01')
    mockServer.use(
      http.put('*/api/v1/bookmarks/:questionId', () =>
        HttpResponse.json(
          {
            code: 'INTERNAL_SERVER_ERROR',
            message: '북마크 저장에 실패했습니다.',
            requestId: crypto.randomUUID(),
            retryable: true
          },
          { status: 500 }
        )
      )
    )
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
    })
    const listKey = bookmarkQueries.list().queryKey
    const cached = {
      items: [],
      page: 1,
      pageSize: 20,
      total: 3
    }
    client.setQueryData(listKey, cached)
    const wrapper = ({ children }: { children: ReactNode }): ReactElement => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const hook = renderHook(() => useCreateBookmark(), { wrapper })

    act(() => hook.result.current.mutate({ questionId }))

    await waitFor(() => expect(hook.result.current.isError).toBe(true))
    expect(client.getQueryData(listKey)).toEqual(cached)
    client.clear()
  })

  it('sibling mutation이 끝나도 마지막 settlement 전에는 optimistic overlay를 유지한다', async () => {
    const user = mockDatabase.loginAs('USER')
    const questionIds = [1, 2, 3].map((index) =>
      getContractQuestionId(`n5-vocabulary-0${index}`)
    )
    const bookmarks = questionIds.map((questionId) =>
      toContractBookmarkSummary(
        mockDatabase.createCanonicalBookmark(
          user.id,
          mockDatabase.resolveCanonicalQuestionId(questionId) ?? ''
        ).source
      )
    )
    const [first, second, optimistic] = bookmarks
    if (!first || !second || !optimistic) {
      throw new Error('Bookmark sibling mutation fixture가 필요합니다.')
    }
    const createGate = createDeferred()
    const deleteGate = createDeferred()
    let serverItems = [second, first]
    mockServer.use(
      http.get('*/api/v1/bookmarks', () =>
        HttpResponse.json({
          items: serverItems,
          page: 1,
          pageSize: 20,
          total: serverItems.length
        })
      ),
      http.put('*/api/v1/bookmarks/:questionId', async () => {
        await createGate.promise
        return HttpResponse.json(
          {
            code: 'INTERNAL_SERVER_ERROR',
            message: '북마크 저장에 실패했습니다.',
            requestId: crypto.randomUUID(),
            retryable: true
          },
          { status: 500 }
        )
      }),
      http.delete('*/api/v1/bookmarks/:questionId', async () => {
        await deleteGate.promise
        serverItems = [first]
        return new HttpResponse(null, {
          status: 204,
          headers: {
            'Cache-Control': 'private, no-store',
            'X-Request-Id': crypto.randomUUID()
          }
        })
      })
    )
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
    })
    const listKey = bookmarkQueries.list().queryKey
    client.setQueryData(listKey, {
      items: [second, first],
      page: 1,
      pageSize: 20,
      total: 2
    })
    const wrapper = ({ children }: { children: ReactNode }): ReactElement => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const hook = renderHook(
      () => ({
        activity: useBookmarkMutationActivity(),
        create: useCreateBookmark(),
        delete: useDeleteBookmark()
      }),
      { wrapper }
    )

    act(() => {
      hook.result.current.create.mutate({
        optimisticBookmark: optimistic,
        questionId: optimistic.questionId
      })
      hook.result.current.delete.mutate(second.questionId)
    })

    deleteGate.release()
    await waitFor(() => {
      expect(hook.result.current.activity.pendingQuestionIds).toEqual(
        new Set([optimistic.questionId])
      )
      expect(client.getQueryData(listKey)).toMatchObject({
        items: expect.arrayContaining([optimistic, first]),
        total: 2
      })
    })

    createGate.release()
    await waitFor(() => {
      expect(hook.result.current.activity.pendingQuestionIds.size).toBe(0)
      expect(client.getQueryData(listKey)).toEqual({
        items: [first],
        page: 1,
        pageSize: 20,
        total: 1
      })
    })
    client.clear()
  })

  it('같은 tick에 끝난 sibling mutation 뒤 마지막 canonical page를 refetch한다', async () => {
    const user = mockDatabase.loginAs('USER')
    const bookmarks = [1, 2, 3].map((index) => {
      const questionId = getContractQuestionId(`n5-vocabulary-0${index}`)
      return toContractBookmarkSummary(
        mockDatabase.createCanonicalBookmark(
          user.id,
          mockDatabase.resolveCanonicalQuestionId(questionId) ?? ''
        ).source
      )
    })
    const [first, second, third] = bookmarks
    if (!first || !second || !third) {
      throw new Error('Bookmark simultaneous settlement fixture가 필요합니다.')
    }
    let serverItems = [third, second, first]
    let listRequestCount = 0
    const deleteGate = createDeferred()
    mockServer.use(
      http.get('*/api/v1/bookmarks', () => {
        listRequestCount += 1
        return HttpResponse.json({
          items: serverItems.slice(0, 1),
          page: 1,
          pageSize: 1,
          total: serverItems.length
        })
      }),
      http.delete('*/api/v1/bookmarks/:questionId', async ({ params }) => {
        await deleteGate.promise
        serverItems = serverItems.filter(
          ({ questionId }) => questionId !== params.questionId
        )
        return new HttpResponse(null, {
          status: 204,
          headers: {
            'Cache-Control': 'private, no-store',
            'X-Request-Id': crypto.randomUUID()
          }
        })
      })
    )
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
    })
    const listKey = bookmarkQueries.list({ pageSize: 1 }).queryKey
    const secondBatchKey = bookmarkQueries.list({
      questionIds: [second.questionId]
    }).queryKey
    client.setQueryData(listKey, {
      items: [third],
      page: 1,
      pageSize: 1,
      total: 3
    })
    client.setQueryData(secondBatchKey, {
      items: [second],
      page: 1,
      pageSize: 20,
      total: 1
    })
    const wrapper = ({ children }: { children: ReactNode }): ReactElement => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const hook = renderHook(
      () => ({
        activity: useBookmarkMutationActivity(),
        delete: useDeleteBookmark(),
        list: useListBookmarks({ pageSize: 1 })
      }),
      { wrapper }
    )

    act(() => {
      hook.result.current.delete.mutate(third.questionId)
      hook.result.current.delete.mutate(second.questionId)
    })
    await waitFor(() =>
      expect(hook.result.current.activity.pendingQuestionIds.size).toBe(2)
    )

    deleteGate.release()
    await waitFor(() => {
      expect(hook.result.current.activity.pendingQuestionIds.size).toBe(0)
      expect(listRequestCount).toBe(1)
      expect(hook.result.current.list.data).toEqual({
        items: [first],
        page: 1,
        pageSize: 1,
        total: 1
      })
    })
    client.clear()
  })
})
