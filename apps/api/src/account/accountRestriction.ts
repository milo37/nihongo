import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import { ApplicationError } from '../errors/applicationError.js'

/**
 * #484 temporary restriction: a restricted member can still sign in, but new
 * study sessions, targeted reviews, result retries and reports are refused.
 */
export interface AccountRestrictionReader {
  isRestricted: (userId: string) => Promise<boolean>
}

const UNAVAILABLE_PRISMA_CODES = new Set(['P1001', 'P1002', 'P2024', 'P2034'])

export const createPrismaAccountRestrictionReader = (
  client: PrismaClient
): AccountRestrictionReader => ({
  isRestricted: async (userId) => {
    try {
      const row = await client.userAccountRestriction.findUnique({
        where: { userId },
        select: { userId: true }
      })
      return row !== null
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientInitializationError ||
        (error instanceof Prisma.PrismaClientKnownRequestError &&
          UNAVAILABLE_PRISMA_CODES.has(error.code))
      ) {
        throw new ApplicationError({
          code: 'SERVICE_UNAVAILABLE',
          message: '계정 상태를 확인할 수 없습니다.',
          retryable: true,
          cause: error
        })
      }
      throw error
    }
  }
})

/** Non-production default when no reader is wired: nobody is restricted. */
export const unrestrictedAccountReader: AccountRestrictionReader = {
  isRestricted: () => Promise.resolve(false)
}

export const assertAccountNotRestricted = async (
  reader: AccountRestrictionReader,
  userId: string
): Promise<void> => {
  if (await reader.isRestricted(userId)) {
    throw new ApplicationError({
      code: 'ACCOUNT_RESTRICTED',
      message: '계정이 임시로 제한되어 새 학습과 제보를 시작할 수 없습니다.',
      retryable: false
    })
  }
}
