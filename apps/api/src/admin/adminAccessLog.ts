import { ApplicationError } from '../errors/applicationError.js'
import { Prisma, type PrismaClient } from '../generated/prisma/client.js'

/**
 * The administrator access record (JLP-842): one row per admin request,
 * written before the request runs. The path names the member, report or
 * question the administrator looked at; the query string is never kept, so a
 * search term (an email) is not stored. The database stamps the time and
 * keeps the row unchanged for 13 months (20261113090000_admin_access_log).
 */
export interface AdminAccessEntry {
  actorId: string
  clientIp: string
  method: string
  path: string
  requestId: string
}

export type AdminAccessRecorder = (entry: AdminAccessEntry) => Promise<void>

const MAX_PATH = 512

/** The stored path: no query, printable ASCII, at most 512 characters. */
export const adminAccessPath = (path: string): string => {
  const printable = path.replace(/[^\x21-\x7e]/gu, (character) =>
    encodeURIComponent(character)
  )
  return printable.length > MAX_PATH ? printable.slice(0, MAX_PATH) : printable
}

const storedIp = (clientIp: string): string =>
  /^[0-9A-Fa-f:.]{2,45}$/u.test(clientIp) ? clientIp : 'unresolved'

export const createPrismaAdminAccessRecorder =
  (client: Pick<PrismaClient, '$executeRaw'>): AdminAccessRecorder =>
  async ({ actorId, clientIp, method, path, requestId }) => {
    await client.$executeRaw(Prisma.sql`
      INSERT INTO "AdminAccessLog"
        ("actorId", "clientIp", "method", "path", "requestId")
      VALUES (${actorId}::uuid, ${storedIp(clientIp)}, ${method},
        ${adminAccessPath(path)}, ${requestId}::uuid)`)
  }

/** Records the access, or refuses the request when the record is not kept. */
export const recordAdminAccessOrRefuse = async (
  recordAccess: AdminAccessRecorder | undefined,
  entry: AdminAccessEntry
): Promise<void> => {
  if (!recordAccess) return
  try {
    await recordAccess(entry)
  } catch (error: unknown) {
    throw new ApplicationError({
      code: 'SERVICE_UNAVAILABLE',
      message: '관리자 접속 기록을 남길 수 없습니다.',
      retryable: true,
      retryAfterSeconds: 5,
      cause: error
    })
  }
}
