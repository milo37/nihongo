import { describe, expect, it, vi } from 'vitest'
import type { Phase7ReauthenticationAuthApi } from '../auth/createPhase7ReauthenticationAuth.js'
import { createPhase7ReauthenticationContext } from '../auth/phase7ReauthenticationContext.js'
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import { createAdminReauthenticationService } from './adminReauthenticationService.js'

const actorId = '019d0000-0000-7000-8000-000000000001'
const intentId = '019d0000-0000-7000-8000-000000000002'
const familyId = '019d0000-0000-7000-8000-000000000003'
const requestId = '019d0000-0000-7000-8000-000000000004'
const operationId = '019d0000-0000-7000-8000-000000000005'
const sessionId = '019d0000-0000-7000-8000-000000000006'
const password = 'phase7-reauth-password'
const token = 'better-auth-generated-token'

const input = {
  actorId,
  headers: new Headers({
    Cookie: 'nihongo.session_token=signed-old-session',
    Origin: 'http://localhost:5173'
  }),
  password,
  rawSessionToken: 'old-session-token',
  requestId
} as const

const prepared = () => ({
  intentId,
  operationId,
  requestId,
  email: 'admin@example.com',
  expiresAt: new Date(Date.now() + 60_000)
})

const finalized = () => ({
  id: sessionId,
  familyId,
  createdAt: new Date('2026-09-16T00:00:00.000Z'),
  expiresAt: new Date('2026-09-17T00:00:00.000Z'),
  authorityGeneration: 3
})

const authSuccess = () => {
  const order: string[] = []
  const headers = new Headers()
  headers.append(
    'Set-Cookie',
    'nihongo.session_token=better-auth-value; Path=/; HttpOnly; SameSite=Lax'
  )
  headers.append(
    'Set-Cookie',
    'nihongo.dont_remember=better-auth-value; Path=/; HttpOnly; SameSite=Lax'
  )
  const verifyPassword = vi.fn(async () => {
    order.push('verifyPassword')
    return { status: true }
  })
  const signInEmail = vi.fn(async () => {
    order.push('signInEmail')
    return {
      headers,
      response: {
        redirect: false,
        token,
        user: { id: actorId, email: 'admin@example.com' }
      }
    }
  })
  return {
    api: { verifyPassword, signInEmail } as Phase7ReauthenticationAuthApi,
    order,
    signInEmail,
    verifyPassword
  }
}

const rawError = (sqlState: string, message = 'database error') =>
  new Prisma.PrismaClientKnownRequestError(message, {
    clientVersion: '7.9.1',
    code: 'P2010',
    meta: { code: sqlState, message }
  })

const serviceWith = (
  query: ReturnType<typeof vi.fn>,
  authApi: Phase7ReauthenticationAuthApi
) =>
  createAdminReauthenticationService({
    auditEnvironment: 'TEST',
    authApi,
    client: { $queryRawUnsafe: query } as unknown as PrismaClient,
    context: createPhase7ReauthenticationContext(),
    createIntentId: () => intentId
  })

describe('Phase 7 Better Auth ADMIN reauthentication service', () => {
  it('verifyPassword 다음 signInEmail을 호출하고 commit-confirmed 뒤 cookie order를 보존한다', async () => {
    const auth = authSuccess()
    const query = vi
      .fn()
      .mockResolvedValueOnce([prepared()])
      .mockResolvedValueOnce([finalized()])

    const output = await serviceWith(query, auth.api).reauthenticate(input)

    expect(auth.order).toEqual(['verifyPassword', 'signInEmail'])
    expect(auth.verifyPassword).toHaveBeenCalledWith({
      headers: input.headers,
      body: { password }
    })
    expect(auth.signInEmail).toHaveBeenCalledWith({
      headers: input.headers,
      body: {
        email: 'admin@example.com',
        password,
        rememberMe: false
      },
      returnHeaders: true
    })
    expect(output.response).toEqual({
      reauthenticatedAt: '2026-09-16T00:00:00.000Z',
      assuranceExpiresAt: '2026-09-16T00:05:00.000Z'
    })
    expect(output.setCookies).toEqual([
      'nihongo.session_token=better-auth-value; Path=/; HttpOnly; SameSite=Lax',
      'nihongo.dont_remember=better-auth-value; Path=/; HttpOnly; SameSite=Lax'
    ])
    expect(query.mock.calls.map(([statement]) => String(statement))).toEqual([
      expect.stringContaining('phase7_prepare_reauthentication'),
      expect.stringContaining('phase7_finalize_reauthentication')
    ])
    expect(query.mock.calls[0]?.slice(1)).toEqual([
      input.rawSessionToken,
      actorId,
      requestId,
      'TEST',
      intentId
    ])
  })

  it('prepare result-loss는 server-owned intent를 exact abort하고 auth를 호출하지 않는다', async () => {
    const auth = authSuccess()
    const query = vi
      .fn()
      .mockRejectedValueOnce(new Error('prepare result unavailable'))
      .mockResolvedValueOnce([{ aborted: true, outcome: 'ACTIVE_ADMIN' }])

    await expect(
      serviceWith(query, auth.api).reauthenticate(input)
    ).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      phase7Disposition: 'DEFINITE_ROLLBACK'
    })
    expect(auth.verifyPassword).not.toHaveBeenCalled()
    expect(auth.signInEmail).not.toHaveBeenCalled()
    expect(query.mock.calls[1]?.slice(1)).toEqual([
      intentId,
      input.rawSessionToken
    ])
  })

  it('prepare definite rollback은 recovery query 없이 NO_TX로 닫는다', async () => {
    const auth = authSuccess()
    const query = vi.fn().mockRejectedValueOnce(rawError('40001'))

    await expect(
      serviceWith(query, auth.api).reauthenticate(input)
    ).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      phase7Disposition: 'NO_TX'
    })
    expect(query).toHaveBeenCalledOnce()
    expect(auth.verifyPassword).not.toHaveBeenCalled()
  })

  it('Better Auth INVALID_PASSWORD는 intent를 제거하고 cookie 없이 stable 실패한다', async () => {
    const auth = authSuccess()
    auth.verifyPassword.mockRejectedValueOnce({ code: 'INVALID_PASSWORD' })
    const query = vi
      .fn()
      .mockResolvedValueOnce([prepared()])
      .mockResolvedValueOnce([{ aborted: true, outcome: 'ACTIVE_ADMIN' }])

    await expect(
      serviceWith(query, auth.api).reauthenticate(input)
    ).rejects.toMatchObject({
      code: 'REAUTHENTICATION_FAILED',
      phase7Disposition: 'NO_TX'
    })
    expect(auth.signInEmail).not.toHaveBeenCalled()
    expect(query.mock.calls[1]?.[0]).toContain(
      'phase7_abort_reauthentication_classified'
    )
  })

  it('verifyPassword status:false는 sign-in 없이 stable credential 실패로 닫는다', async () => {
    const auth = authSuccess()
    auth.verifyPassword.mockResolvedValueOnce({ status: false })
    const query = vi
      .fn()
      .mockResolvedValueOnce([prepared()])
      .mockResolvedValueOnce([{ aborted: true, outcome: 'ACTIVE_ADMIN' }])

    await expect(
      serviceWith(query, auth.api).reauthenticate(input)
    ).rejects.toMatchObject({
      code: 'REAUTHENTICATION_FAILED',
      phase7Disposition: 'NO_TX'
    })
    expect(auth.signInEmail).not.toHaveBeenCalled()
  })

  it.each([
    ['ACTIVE_ADMIN', 'REAUTHENTICATION_FAILED'],
    ['ADMIN_REQUIRED', 'ADMIN_REQUIRED'],
    ['AUTH_SESSION_EXPIRED', 'AUTH_SESSION_EXPIRED']
  ] as const)(
    'sign-in invalid credential에서 old authority %s를 우선해 %s로 닫는다',
    async (outcome, expectedCode) => {
      const auth = authSuccess()
      auth.signInEmail.mockRejectedValueOnce({
        body: { code: 'INVALID_EMAIL_OR_PASSWORD' }
      })
      const query = vi
        .fn()
        .mockResolvedValueOnce([prepared()])
        .mockResolvedValueOnce([{ aborted: true, outcome }])

      await expect(
        serviceWith(query, auth.api).reauthenticate(input)
      ).rejects.toMatchObject({ code: expectedCode })
    }
  )

  it('credential 실패의 abort=false는 성공으로 오판하지 않고 COMMIT_UNKNOWN으로 닫는다', async () => {
    const auth = authSuccess()
    auth.verifyPassword.mockRejectedValueOnce({ code: 'INVALID_PASSWORD' })
    const query = vi
      .fn()
      .mockResolvedValueOnce([prepared()])
      .mockResolvedValueOnce([{ aborted: false, outcome: 'ACTIVE_ADMIN' }])

    await expect(
      serviceWith(query, auth.api).reauthenticate(input)
    ).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      phase7Disposition: 'COMMIT_UNKNOWN'
    })
  })

  it('finalizer definite rollback은 pending을 abort하고 bounded 403으로 분류한다', async () => {
    const auth = authSuccess()
    const query = vi
      .fn()
      .mockResolvedValueOnce([prepared()])
      .mockRejectedValueOnce(rawError('42501'))
      .mockResolvedValueOnce([{ aborted: true, outcome: 'ADMIN_REQUIRED' }])

    await expect(
      serviceWith(query, auth.api).reauthenticate(input)
    ).rejects.toMatchObject({
      code: 'ADMIN_REQUIRED',
      phase7Disposition: 'DEFINITE_ROLLBACK'
    })
    expect(query.mock.calls[2]?.[0]).toContain(
      'phase7_abort_reauthentication_classified'
    )
  })

  it.each(['40001', '23514', '40P01'] as const)(
    'finalizer %s definite rollback과 ACTIVE_ADMIN은 cookie 없이 503으로 닫는다',
    async (sqlState) => {
      const auth = authSuccess()
      const query = vi
        .fn()
        .mockResolvedValueOnce([prepared()])
        .mockRejectedValueOnce(rawError(sqlState))
        .mockResolvedValueOnce([{ aborted: true, outcome: 'ACTIVE_ADMIN' }])

      await expect(
        serviceWith(query, auth.api).reauthenticate(input)
      ).rejects.toMatchObject({
        code: 'SERVICE_UNAVAILABLE',
        phase7Disposition: 'DEFINITE_ROLLBACK'
      })
      expect(query.mock.calls.map(([statement]) => String(statement))).toEqual([
        expect.stringContaining('phase7_prepare_reauthentication'),
        expect.stringContaining('phase7_finalize_reauthentication'),
        expect.stringContaining('phase7_abort_reauthentication_classified')
      ])
    }
  )

  it('finalizer rollback과 abort=false 경쟁은 exact fence/audit reconciliation만 성공시킨다', async () => {
    const auth = authSuccess()
    const query = vi
      .fn()
      .mockResolvedValueOnce([prepared()])
      .mockRejectedValueOnce(rawError('40001'))
      .mockResolvedValueOnce([{ aborted: false, outcome: 'ACTIVE_ADMIN' }])
      .mockResolvedValueOnce([{ ...finalized(), state: 'FINALIZED' }])

    const output = await serviceWith(query, auth.api).reauthenticate(input)

    expect(output.setCookies).toHaveLength(2)
    expect(query.mock.calls[3]?.[0]).toContain(
      'phase7_reconcile_reauthentication'
    )
  })

  it('finalizer rollback과 abort=false인데 proof가 없으면 COMMIT_UNKNOWN으로 닫는다', async () => {
    const auth = authSuccess()
    const query = vi
      .fn()
      .mockResolvedValueOnce([prepared()])
      .mockRejectedValueOnce(rawError('40001'))
      .mockResolvedValueOnce([{ aborted: false, outcome: 'ACTIVE_ADMIN' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ compensated: true }])

    await expect(
      serviceWith(query, auth.api).reauthenticate(input)
    ).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      phase7Disposition: 'COMMIT_UNKNOWN'
    })
    expect(query.mock.calls[4]?.[0]).toContain(
      'phase7_compensate_reauthentication'
    )
    expect(query.mock.calls[4]?.slice(1)).toEqual([intentId, token])
  })

  it('commit-unknown은 exact fence/audit proof가 reconcile될 때만 held cookies를 반환한다', async () => {
    const auth = authSuccess()
    const query = vi
      .fn()
      .mockResolvedValueOnce([prepared()])
      .mockRejectedValueOnce(new Error('connection result unavailable'))
      .mockResolvedValueOnce([{ ...finalized(), state: 'FINALIZED' }])

    const output = await serviceWith(query, auth.api).reauthenticate(input)

    expect(output.setCookies).toHaveLength(2)
    expect(query.mock.calls[2]?.[0]).toContain(
      'phase7_reconcile_reauthentication'
    )
  })

  it('commit-unknown proof가 없으면 abort 후 cookies를 공개하지 않는다', async () => {
    const auth = authSuccess()
    const query = vi
      .fn()
      .mockResolvedValueOnce([prepared()])
      .mockRejectedValueOnce(new Error('connection result unavailable'))
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('retry result unavailable'))
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ aborted: true }])

    await expect(
      serviceWith(query, auth.api).reauthenticate(input)
    ).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      phase7Disposition: 'COMMIT_UNKNOWN'
    })
    expect(
      query.mock.calls.filter(([statement]) =>
        String(statement).includes('phase7_finalize_reauthentication')
      )
    ).toHaveLength(2)
  })

  it('commit-unknown exact miss 뒤 같은 intent finalizer를 한 번만 retry한다', async () => {
    const auth = authSuccess()
    const query = vi
      .fn()
      .mockResolvedValueOnce([prepared()])
      .mockRejectedValueOnce(new Error('connection result unavailable'))
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([finalized()])

    const output = await serviceWith(query, auth.api).reauthenticate(input)

    expect(output.setCookies).toHaveLength(2)
    expect(
      query.mock.calls.filter(([statement]) =>
        String(statement).includes('phase7_finalize_reauthentication')
      )
    ).toHaveLength(2)
  })

  it('commit-confirmed invalid replacement는 intent-scoped 보상 뒤 cookie 없이 닫는다', async () => {
    const auth = authSuccess()
    const invalidFinalized = {
      ...finalized(),
      expiresAt: new Date('2026-09-16T12:00:00.000Z')
    }
    const query = vi
      .fn()
      .mockResolvedValueOnce([prepared()])
      .mockResolvedValueOnce([invalidFinalized])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ aborted: false }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ compensated: true }])

    await expect(
      serviceWith(query, auth.api).reauthenticate(input)
    ).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      phase7Disposition: 'COMMIT_CONFIRMED'
    })
    expect(query.mock.calls[5]?.[0]).toContain(
      'phase7_compensate_reauthentication'
    )
    expect(query.mock.calls[5]?.slice(1)).toEqual([intentId, token])
  })

  it('commit-confirmed invalid replacement의 보상 실패도 cookie 없이 503이다', async () => {
    const auth = authSuccess()
    const query = vi
      .fn()
      .mockResolvedValueOnce([prepared()])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ aborted: false }])
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('compensation failed'))

    await expect(
      serviceWith(query, auth.api).reauthenticate(input)
    ).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      phase7Disposition: 'COMMIT_CONFIRMED'
    })
    expect(query.mock.calls[5]?.[0]).toContain(
      'phase7_compensate_reauthentication'
    )
  })

  it('Set-Cookie가 comma-join되거나 순서가 없으면 pending을 제거한다', async () => {
    const auth = authSuccess()
    const invalidHeaders = new Headers({
      'Set-Cookie':
        'nihongo.session_token=x; Path=/, nihongo.dont_remember=y; Path=/'
    })
    auth.signInEmail.mockResolvedValueOnce({
      headers: invalidHeaders,
      response: {
        redirect: false,
        token,
        user: { id: actorId, email: 'admin@example.com' }
      }
    })
    const query = vi
      .fn()
      .mockResolvedValueOnce([prepared()])
      .mockResolvedValueOnce([{ aborted: true, outcome: 'ACTIVE_ADMIN' }])

    await expect(
      serviceWith(query, auth.api).reauthenticate(input)
    ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' })
    expect(query.mock.calls[1]?.[0]).toContain(
      'phase7_abort_reauthentication_classified'
    )
  })
})
