import type { UpdateTargetLevelResponse } from '@nihongo/contracts/auth/update-target-level'
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import { ApplicationError } from '../errors/applicationError.js'

type JlptLevel = UpdateTargetLevelResponse['targetLevel']

export interface TargetLevelRepository {
  /** Returns the stored level, or null when no ACTIVE member owns the id. */
  update: (userId: string, targetLevel: JlptLevel) => Promise<JlptLevel | null>
}

export interface TargetLevelService {
  update: (
    userId: string,
    targetLevel: JlptLevel
  ) => Promise<UpdateTargetLevelResponse>
}

export class TargetLevelRepositoryUnavailableError extends Error {
  constructor(options: ErrorOptions) {
    super('Target level repository is unavailable.', options)
    this.name = 'TargetLevelRepositoryUnavailableError'
  }
}

const UNAVAILABLE_PRISMA_CODES = new Set(['P1001', 'P1002', 'P2024', 'P2034'])

const isDatabaseUnavailableError = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientInitializationError ||
  (error instanceof Prisma.PrismaClientKnownRequestError &&
    UNAVAILABLE_PRISMA_CODES.has(error.code))

/**
 * JLP-815: nihongo_app may UPDATE only "targetLevel" on "User"
 * (20261111090000_grant_user_target_level_update), so this statement touches
 * no other column, "updatedAt" included.
 */
export const createPrismaTargetLevelRepository = (
  client: PrismaClient
): TargetLevelRepository => ({
  update: async (userId, targetLevel) => {
    try {
      const rows = await client.$queryRaw<Array<{ targetLevel: JlptLevel }>>(
        Prisma.sql`
          UPDATE "User"
          SET "targetLevel" = ${targetLevel}::"JlptLevel"
          WHERE "id" = ${userId}::uuid
            AND "accountStatus" = 'ACTIVE'
            AND "deletedAt" IS NULL
          RETURNING "targetLevel"
        `
      )
      return rows[0]?.targetLevel ?? null
    } catch (error: unknown) {
      if (isDatabaseUnavailableError(error)) {
        throw new TargetLevelRepositoryUnavailableError({ cause: error })
      }
      throw error
    }
  }
})

export const createTargetLevelService = (
  repository: TargetLevelRepository
): TargetLevelService => ({
  update: async (userId, targetLevel) => {
    let stored: JlptLevel | null
    try {
      stored = await repository.update(userId, targetLevel)
    } catch (error: unknown) {
      if (error instanceof TargetLevelRepositoryUnavailableError) {
        throw new ApplicationError({
          code: 'SERVICE_UNAVAILABLE',
          message: '목표 급수를 저장할 수 없습니다.',
          retryable: true,
          cause: error
        })
      }
      throw error
    }
    if (stored === null) {
      throw new ApplicationError({
        code: 'AUTHENTICATION_REQUIRED',
        message: '목표 급수는 로그인이 필요합니다.',
        retryable: false
      })
    }
    return { targetLevel: stored }
  }
})
