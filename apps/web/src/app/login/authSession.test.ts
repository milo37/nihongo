import { QueryClient } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { refreshCanonicalAuthAfterMutation } from '@app/login/authSession'
import { authQueries } from '@app/login/queries/authQueries'
import { mockDatabase } from '@mocks/repository/mockDatabase'
import { useAppStore } from '@store/index'
import { mockServer } from '@/test/server'

describe('refreshCanonicalAuthAfterMutation', () => {
  it('mutation 이전의 in-flight /me를 취소하고 새 principal만 반영한다', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    })
    let requestCount = 0
    let markFirstRequestStarted: (() => void) | undefined
    let releaseFirstRequest: (() => void) | undefined
    const firstRequestStarted = new Promise<void>((resolve) => {
      markFirstRequestStarted = resolve
    })
    const delayedFirstResponse = new Promise<void>((resolve) => {
      releaseFirstRequest = resolve
    })

    mockServer.use(
      http.get('*/api/v1/me', async () => {
        requestCount += 1
        if (requestCount === 1) {
          markFirstRequestStarted?.()
          await delayedFirstResponse
          return HttpResponse.json({ kind: 'GUEST' as const })
        }

        const user = mockDatabase.getCurrentUser()
        return HttpResponse.json(
          user
            ? {
                kind: 'USER' as const,
                user: {
                  id: user.id,
                  name: user.name,
                  role: user.role,
                  targetLevel: user.targetLevel
                }
              }
            : { kind: 'GUEST' as const }
        )
      })
    )

    const staleRequest = client
      .fetchQuery(authQueries.currentUser())
      .catch(() => null)
    await firstRequestStarted
    const admin = mockDatabase.loginAs('ADMIN')
    useAppStore
      .getState()
      .beginPractice('stale-session', '2026-08-14T00:00:00.000Z')
    client.setQueryData(['wrong-note', 'private'], { owner: 'previous-user' })

    const result = await refreshCanonicalAuthAfterMutation(client, {
      expectedIdentity: 'AUTHENTICATED',
      forceClear: true,
      forcePracticeReset: true
    })
    releaseFirstRequest?.()
    await staleRequest

    expect(result.applied).toBe(true)
    expect(requestCount).toBe(2)
    expect(useAppStore.getState().currentUser?.id).toBe(admin.id)
    expect(useAppStore.getState().sessionId).toBeNull()
    expect(client.getQueryData(['wrong-note', 'private'])).toBeUndefined()
    expect(
      client.getQueryData(authQueries.currentUser().queryKey)
    ).toMatchObject({ id: admin.id, role: 'ADMIN' })
  })
})
