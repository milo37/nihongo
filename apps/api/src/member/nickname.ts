import type { UpdateNicknameResponse } from '@nihongo/contracts/auth/update-nickname'
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import { ApplicationError } from '../errors/applicationError.js'

export interface NicknameRepository {
  /** Returns the stored nickname, or null when no ACTIVE member owns the id. */
  update: (userId: string, nickname: string) => Promise<string | null>
}

export interface NicknameService {
  update: (userId: string, nickname: string) => Promise<UpdateNicknameResponse>
}

export class NicknameRepositoryUnavailableError extends Error {
  constructor(options: ErrorOptions) {
    super('Nickname repository is unavailable.', options)
    this.name = 'NicknameRepositoryUnavailableError'
  }
}

const UNAVAILABLE_PRISMA_CODES = new Set(['P1001', 'P1002', 'P2024', 'P2034'])

const isDatabaseUnavailableError = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientInitializationError ||
  (error instanceof Prisma.PrismaClientKnownRequestError &&
    UNAVAILABLE_PRISMA_CODES.has(error.code))

/**
 * #1096: nihongo_app may UPDATE "User"."name" (the nickname) and
 * "targetLevel" only (20261120090000_grant_user_name_update), so this
 * statement touches no other column, "updatedAt" included. The caller passes
 * a nickname the contract already trimmed and checked.
 */
export const createPrismaNicknameRepository = (
  client: PrismaClient
): NicknameRepository => ({
  update: async (userId, nickname) => {
    try {
      const rows = await client.$queryRaw<Array<{ name: string }>>(
        Prisma.sql`
          UPDATE "User"
          SET "name" = ${nickname}
          WHERE "id" = ${userId}::uuid
            AND "accountStatus" = 'ACTIVE'
            AND "deletedAt" IS NULL
          RETURNING "name"
        `
      )
      return rows[0]?.name ?? null
    } catch (error: unknown) {
      if (isDatabaseUnavailableError(error)) {
        throw new NicknameRepositoryUnavailableError({ cause: error })
      }
      throw error
    }
  }
})

export const createNicknameService = (
  repository: NicknameRepository
): NicknameService => ({
  update: async (userId, nickname) => {
    let stored: string | null
    try {
      stored = await repository.update(userId, nickname)
    } catch (error: unknown) {
      if (error instanceof NicknameRepositoryUnavailableError) {
        throw new ApplicationError({
          code: 'SERVICE_UNAVAILABLE',
          message: '닉네임을 저장할 수 없습니다.',
          retryable: true,
          cause: error
        })
      }
      throw error
    }
    if (stored === null) {
      throw new ApplicationError({
        code: 'AUTHENTICATION_REQUIRED',
        message: '닉네임은 로그인이 필요합니다.',
        retryable: false
      })
    }
    return { nickname: stored }
  }
})
