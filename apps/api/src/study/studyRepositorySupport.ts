import { Prisma } from '../generated/prisma/client.js'
import type { ExistingStudyOwner } from './studySessionRepository.js'

/** Helpers the study session, submission, draft and retry repositories share. */
const UNAVAILABLE_PRISMA_CODES = new Set(['P1001', 'P1002', 'P2024'])

export const MAX_TRANSACTION_ATTEMPTS = 3
export const RETRY_BASE_DELAY_MS = 5
export const RETRY_JITTER_MAX_MS = 5

export const isDatabaseUnavailableError = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientInitializationError ||
  (error instanceof Prisma.PrismaClientKnownRequestError &&
    UNAVAILABLE_PRISMA_CODES.has(error.code))

export const delay = async (milliseconds: number): Promise<void> =>
  await new Promise((resolve) => setTimeout(resolve, milliseconds))

export interface ReservationRow {
  id: string
}

export const isSerializableConflict = (error: unknown): boolean => {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    return false
  }
  const sqlState = error.meta?.code
  return (
    error.code === 'P2034' ||
    (error.code === 'P2010' &&
      (sqlState === '40001' ||
        sqlState === '40P01' ||
        /Code: [`'](?:40001|40P01)[`']/u.test(error.message)))
  )
}

export const ownerWhere = (owner: ExistingStudyOwner) =>
  owner.kind === 'USER'
    ? { userId: owner.userId }
    : { guestPrincipalId: owner.guestPrincipalId }

export const idempotencyOwnerWhere = (owner: ExistingStudyOwner) =>
  owner.kind === 'USER'
    ? {
        principalType: 'USER' as const,
        userId: owner.userId,
        guestPrincipalId: null
      }
    : {
        principalType: 'GUEST' as const,
        userId: null,
        guestPrincipalId: owner.guestPrincipalId
      }
