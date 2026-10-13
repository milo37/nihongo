import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual
} from 'node:crypto'
import { z } from 'zod'
import type { PrismaClient } from '../generated/prisma/client.js'

const GUEST_TTL_MS = 7 * 24 * 60 * 60 * 1_000
const guestCookieSchema = z.tuple([
  z.uuid(),
  z.string().min(32),
  z.string().min(32)
])

interface CreateGuestPrincipalServiceDependencies {
  client: PrismaClient
  secret: string
}

export type InspectedGuestCredential =
  | { kind: 'ABSENT' }
  | { kind: 'INVALID' }
  | { kind: 'VERIFIED'; id: string; tokenDigest: string }

export interface PreparedGuestCredential {
  cookieValue: string
  createdAt: Date
  expiresAt: Date
  id: string
  tokenDigest: string
}

export interface ResolvedGuestPrincipal {
  cookieValue: string | null
  id: string
}

const digestToken = (rawToken: string): string =>
  createHash('sha256').update(rawToken).digest('hex')

const signPayload = (payload: string, secret: string): string =>
  createHmac('sha256', secret).update(payload).digest('base64url')

const parseVerifiedCookie = (
  cookieValue: string | undefined,
  secret: string
): { id: string; rawToken: string } | null => {
  if (!cookieValue) {
    return null
  }

  const parsed = guestCookieSchema.safeParse(cookieValue.split('.'))
  if (!parsed.success) {
    return null
  }

  const [id, rawToken, signature] = parsed.data
  const expectedSignature = signPayload(`${id}.${rawToken}`, secret)
  const received = Buffer.from(signature)
  const expected = Buffer.from(expectedSignature)

  if (
    received.length !== expected.length ||
    !timingSafeEqual(received, expected)
  ) {
    return null
  }

  return { id, rawToken }
}

export interface GuestPrincipalService {
  clear: (cookieValue: string | undefined) => Promise<void>
  create: () => Promise<ResolvedGuestPrincipal>
  deleteExpired: (batchSize?: number) => Promise<number>
  inspectCookie: (cookieValue: string | undefined) => InspectedGuestCredential
  prepareCredential: () => PreparedGuestCredential
  resolveExisting: (
    cookieValue: string | undefined
  ) => Promise<ResolvedGuestPrincipal | null>
}

export const createGuestPrincipalService = ({
  client,
  secret
}: CreateGuestPrincipalServiceDependencies): GuestPrincipalService => {
  const inspectCookie = (
    cookieValue: string | undefined
  ): InspectedGuestCredential => {
    if (!cookieValue) {
      return { kind: 'ABSENT' }
    }
    const verified = parseVerifiedCookie(cookieValue, secret)
    return verified
      ? {
          kind: 'VERIFIED',
          id: verified.id,
          tokenDigest: digestToken(verified.rawToken)
        }
      : { kind: 'INVALID' }
  }

  const prepareCredential = (): PreparedGuestCredential => {
    const id = randomUUID()
    const rawToken = randomBytes(32).toString('base64url')
    const createdAt = new Date()
    const payload = `${id}.${rawToken}`

    return {
      id,
      tokenDigest: digestToken(rawToken),
      createdAt,
      expiresAt: new Date(createdAt.getTime() + GUEST_TTL_MS),
      cookieValue: `${payload}.${signPayload(payload, secret)}`
    }
  }

  const findValidGuest = async (
    cookieValue: string | undefined
  ): Promise<ResolvedGuestPrincipal | null> => {
    const verified = parseVerifiedCookie(cookieValue, secret)
    if (!verified) {
      return null
    }

    const guest = await client.guestPrincipal.findUnique({
      where: { id: verified.id }
    })
    const now = new Date()

    if (
      !guest ||
      guest.expiresAt <= now ||
      guest.tokenDigest !== digestToken(verified.rawToken)
    ) {
      if (guest?.expiresAt && guest.expiresAt <= now) {
        await client.guestPrincipal.deleteMany({
          where: { id: guest.id, studySessions: { none: {} } }
        })
      }
      return null
    }

    await client.guestPrincipal.update({
      where: { id: guest.id },
      data: { lastSeenAt: now }
    })

    return { id: guest.id, cookieValue: null }
  }

  return {
    clear: async (cookieValue) => {
      const verified = parseVerifiedCookie(cookieValue, secret)
      if (verified) {
        await client.guestPrincipal.deleteMany({ where: { id: verified.id } })
      }
    },
    create: async () => {
      const prepared = prepareCredential()
      const guest = await client.guestPrincipal.create({
        data: {
          id: prepared.id,
          tokenDigest: prepared.tokenDigest,
          createdAt: prepared.createdAt,
          lastSeenAt: prepared.createdAt,
          expiresAt: prepared.expiresAt
        },
        select: { id: true }
      })

      return {
        id: guest.id,
        cookieValue: prepared.cookieValue
      }
    },
    deleteExpired: async (batchSize = 100) => {
      const safeBatchSize = Math.max(1, Math.min(batchSize, 1_000))
      const now = new Date()
      const expired = await client.guestPrincipal.findMany({
        where: {
          expiresAt: { lte: now },
          studySessions: { none: {} }
        },
        orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
        take: safeBatchSize,
        select: { id: true }
      })
      if (expired.length === 0) {
        return 0
      }
      const result = await client.guestPrincipal.deleteMany({
        where: {
          expiresAt: { lte: now },
          id: { in: expired.map(({ id }) => id) },
          studySessions: { none: {} }
        }
      })
      return result.count
    },
    inspectCookie,
    prepareCredential,
    resolveExisting: findValidGuest
  }
}
