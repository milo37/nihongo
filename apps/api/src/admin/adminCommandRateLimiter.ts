import type { PrismaClient } from '../generated/prisma/client.js'
import {
  consumeRateLimitKeys,
  createRateLimitKey,
  type RateLimitPolicy
} from './keyedRateLimitStore.js'

export type AdminCommandRateLimitGroup =
  | 'ADMIN_EDIT'
  | 'ADMIN_SENSITIVE'
  | 'IMPORT_VALIDATION'
  | 'REAUTHENTICATION'

interface AdminCommandRateLimitInput {
  actorId: string
  clientIp: string
  group: AdminCommandRateLimitGroup
}

export interface AdminCommandRateLimiter {
  consume: (input: AdminCommandRateLimitInput) => Promise<void>
}

const policyByGroup = {
  ADMIN_EDIT: { limit: 30, windowMilliseconds: 10 * 60_000 },
  ADMIN_SENSITIVE: { limit: 10, windowMilliseconds: 15 * 60_000 },
  IMPORT_VALIDATION: { limit: 20, windowMilliseconds: 15 * 60_000 },
  REAUTHENTICATION: { limit: 5, windowMilliseconds: 15 * 60_000 }
} as const satisfies Readonly<
  Record<AdminCommandRateLimitGroup, RateLimitPolicy>
>

const settings = {
  storeUnavailableMessage: '관리자 명령 제한 저장소에 연결할 수 없습니다.',
  stateInvalidMessage: '관리자 명령 제한 상태를 확인할 수 없습니다.',
  rateLimitedMessage: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
  phase7Disposition: 'NO_TX'
} as const

export const createAdminCommandRateLimiter = ({
  client,
  keySecret
}: {
  client: Pick<PrismaClient, '$queryRaw'>
  keySecret: string
}): AdminCommandRateLimiter => ({
  consume: ({ actorId, clientIp, group }) =>
    consumeRateLimitKeys({
      client,
      keys: [
        createRateLimitKey({
          dimension: 'ACTOR',
          group,
          keySecret,
          value: actorId
        }),
        createRateLimitKey({
          dimension: 'IP',
          group,
          keySecret,
          value: clientIp
        })
      ],
      policy: policyByGroup[group],
      settings
    })
})
