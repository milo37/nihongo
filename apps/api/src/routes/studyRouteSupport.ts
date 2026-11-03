import type { Context } from 'hono'
import { getCookie } from 'hono/cookie'
import type { GuestPrincipalService } from '../auth/guestPrincipalService.js'
import type { PrincipalService } from '../auth/principalService.js'
import type { ApiEnvironment } from '../config/env.js'
import { ApplicationError } from '../errors/applicationError.js'
import type { ExistingStudyOwner } from '../study/studySessionRepository.js'
import { GUEST_COOKIE_NAME } from './principal.js'
import { appendAuthHeaders } from './routeSupport.js'

export const resolvePracticeContractVersion = (
  value: string | undefined,
  practiceContractV2Enabled: boolean
): 1 | 2 => {
  if (value === undefined || value === '2') {
    if (!practiceContractV2Enabled) {
      throw new ApplicationError({
        code: 'INVALID_REQUEST',
        message: '이 배포 세대에서는 practice contract 2를 사용할 수 없습니다.',
        retryable: false
      })
    }
    return 2
  }
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
