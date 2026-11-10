import type { Context } from 'hono'
import { getCookie } from 'hono/cookie'
import type { GuestPrincipalService } from '../auth/guestPrincipalService.js'
import type { PrincipalService } from '../auth/principalService.js'
import type { ApiEnvironment } from '../config/env.js'
import { ApplicationError } from '../errors/applicationError.js'
import type { ExistingStudyOwner } from '../study/studySessionRepository.js'
import { nextGuestDayStart } from '../study/guestDay.js'
import { GUEST_COOKIE_NAME } from './principal.js'
import { appendAuthHeaders } from './routeSupport.js'

/** Practice contract 2 is the only contract; the header may be omitted. */
export const assertPracticeContractHeader = (
  value: string | undefined
): void => {
  if (value === undefined || value === '2') return
  throw new ApplicationError({
    code: 'INVALID_REQUEST',
    message: 'X-Nihongo-Practice-Contract header 값이 올바르지 않습니다.',
    fieldErrors: {
      'x-nihongo-practice-contract': ['header 값은 2만 허용합니다.']
    },
    retryable: false
  })
}

interface ExistingStudyOwnerResolution {
  owner: ExistingStudyOwner
  rawGuestCookie: string | undefined
}

export const resolveExistingStudyOwner = async ({
  authenticationRequiredMessage,
  context,
  environment,
  guestPrincipalService,
  principalService
}: {
  authenticationRequiredMessage: string
  context: Context
  environment: ApiEnvironment
  guestPrincipalService: GuestPrincipalService
  principalService: PrincipalService
}): Promise<ExistingStudyOwnerResolution> => {
  const resolution = await principalService.resolveAuthenticatedUser(
    context.req.raw.headers
  )
  appendAuthHeaders(context, resolution, environment)
  if (resolution.user) {
    return {
      owner: { kind: 'USER', userId: resolution.user.id },
      rawGuestCookie: undefined
    }
  }
  const rawGuestCookie = getCookie(context, GUEST_COOKIE_NAME)
  const inspected = guestPrincipalService.inspectCookie(rawGuestCookie)
  if (inspected.kind === 'ABSENT') {
    throw new ApplicationError({
      code: 'AUTHENTICATION_REQUIRED',
      message: authenticationRequiredMessage,
      retryable: false
    })
  }
  if (inspected.kind === 'INVALID') {
    throw new ApplicationError({
      code: 'GUEST_SESSION_EXPIRED',
      message: '게스트 세션이 만료됐습니다.',
      retryable: false
    })
  }
  return {
    owner: {
      kind: 'GUEST',
      guestPrincipalId: inspected.id,
      tokenDigest: inspected.tokenDigest
    },
    rawGuestCookie
  }
}

/** The hidden per-IP guest limit; guests see the same daily-limit card. */
export const guestIpLimitReached = (at: Date): ApplicationError =>
  new ApplicationError({
    code: 'GUEST_LIMIT_REACHED',
    message:
      '오늘 이 네트워크에서 비회원으로 풀 수 있는 횟수를 모두 썼습니다. 더 풀려면 로그인해 주세요.',
    details: { resetsAt: nextGuestDayStart(at).toISOString() },
    retryable: false
  })
