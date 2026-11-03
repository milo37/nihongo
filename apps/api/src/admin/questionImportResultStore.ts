import {
  adminImportApplyResponseSchema,
  type AdminImportApplyResponse
} from '@nihongo/contracts/admin/content-operations'
import { z } from 'zod'
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'

/** Stored apply result; replayed for the same importId, actor and digest. */
export interface StoredImportResult {
  readonly actorUserId: string
  readonly requestDigest: string
  readonly response: AdminImportApplyResponse
  readonly mappingDigest: string
}

const storedPayloadSchema = z
  .object({
    response: adminImportApplyResponseSchema,
    mappingDigest: z.string().regex(/^[0-9a-f]{64}$/u)
  })
  .strict()

// Same raw call surface as the import repository (and its test clients).
type QueryClient = Pick<PrismaClient, '$queryRawUnsafe' | '$executeRawUnsafe'>

export const readStoredImportResult = async (
  client: QueryClient,
  importId: string
): Promise<StoredImportResult | null> => {
  const [row] = await client.$queryRawUnsafe<
    { actorUserId: string; requestDigest: string; response: unknown }[]
  >(
    `SELECT "actorUserId", "requestDigest", "response"
     FROM "QuestionImportResult" WHERE "importId" = $1::uuid`,
    importId
  )
  if (!row) return null
  const payload = storedPayloadSchema.parse(row.response)
  return {
    actorUserId: row.actorUserId,
    requestDigest: row.requestDigest,
    response: payload.response,
    mappingDigest: payload.mappingDigest
  }
}

export const insertStoredImportResult = async (
  client: QueryClient,
  input: { readonly importId: string } & StoredImportResult
): Promise<void> => {
  const payload = JSON.stringify({
    response: input.response,
    mappingDigest: input.mappingDigest
  })
  await client.$executeRawUnsafe(
    `INSERT INTO "QuestionImportResult" (
       "importId", "actorUserId", "requestDigest", "response"
     ) VALUES ($1::uuid, $2::uuid, $3, $4::jsonb)`,
    input.importId,
    input.actorUserId,
    input.requestDigest,
    payload
  )
}

export class QuestionImportResultUnavailableError extends Error {
  constructor(options: ErrorOptions) {
    super('Question import result store is unavailable.', options)
    this.name = 'QuestionImportResultUnavailableError'
  }
}

const UNAVAILABLE_PRISMA_CODES = new Set(['P1001', 'P1002', 'P2024', 'P2034'])

/** GET /admin/question-imports/:importId; any admin may recover a result. */
export const createQuestionImportResultReader =
  (client: PrismaClient) =>
  async (importId: string): Promise<AdminImportApplyResponse | null> => {
    try {
      return (await readStoredImportResult(client, importId))?.response ?? null
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientInitializationError ||
        (error instanceof Prisma.PrismaClientKnownRequestError &&
          UNAVAILABLE_PRISMA_CODES.has(error.code))
      ) {
        throw new QuestionImportResultUnavailableError({ cause: error })
      }
      throw error
    }
  }
