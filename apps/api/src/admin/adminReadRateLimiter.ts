import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import {
  consumeRateLimitKeys,
  createRateLimitKey
} from './keyedRateLimitStore.js'

interface AdminReadRateLimitInput {
  actorId: string
  clientIp: string
}

export interface AdminReadRateLimiter {
  consume: (input: AdminReadRateLimitInput) => Promise<void>
}

const GROUP = 'ADMIN_READ'
const policy = { limit: 120, windowMilliseconds: 60_000 } as const

const settings = {
  storeUnavailableMessage: '관리자 조회 제한 저장소에 연결할 수 없습니다.',
  stateInvalidMessage: '관리자 조회 제한 상태를 확인할 수 없습니다.',
  rateLimitedMessage: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
  // Reads map only connection loss; other store errors stay internal errors.
  isStoreError: (error: unknown): boolean =>
    error instanceof Prisma.PrismaClientInitializationError ||
    (error instanceof Prisma.PrismaClientKnownRequestError &&
      ['P1001', 'P1002', 'P2024', 'P2034'].includes(error.code))
} as const

export const createAdminReadRateLimiter = ({
  client,
  keySecret
}: {
  client: Pick<PrismaClient, '$queryRaw'>
  keySecret: string
}): AdminReadRateLimiter => ({
  consume: ({ actorId, clientIp }) =>
    consumeRateLimitKeys({
      client,
      keys: [
        createRateLimitKey({
          dimension: 'ACTOR',
          group: GROUP,
          keySecret,
          value: actorId
        }),
        createRateLimitKey({
          dimension: 'IP',
          group: GROUP,
          keySecret,
          value: clientIp
        })
      ],
      policy,
      settings
    })
})
