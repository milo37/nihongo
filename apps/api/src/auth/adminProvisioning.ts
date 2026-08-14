import { createHash, randomUUID } from 'node:crypto'
import type { PrismaClient } from '../generated/prisma/client.js'

export interface AdminProvisioningInput {
  email: string
  name: string
  password: string
  reference: string
  targetLevel?: 'N5' | 'N4' | 'N3' | 'N2' | 'N1'
}

export interface AdminProvisioningResult {
  outcome: 'CREATED' | 'ALREADY_PROVISIONED'
  referenceDigest: string
  userId: string
}

interface CreateAdminProvisionerDependencies {
  client: PrismaClient
  createUserId?: () => string
  hashPassword: (password: string) => Promise<string>
}

export class AdminProvisioningError extends Error {
  constructor(
    readonly code:
      | 'ACCOUNT_CREATION_FAILED'
      | 'EXISTING_NON_ADMIN_ACCOUNT'
      | 'INVALID_EXISTING_ADMIN'
  ) {
    super(code)
    this.name = 'AdminProvisioningError'
  }
}

const getReferenceDigest = (reference: string): string =>
  createHash('sha256').update(reference).digest('hex')

export const createAdminProvisioner = ({
  client,
  createUserId = randomUUID,
  hashPassword
}: CreateAdminProvisionerDependencies) => {
  const readExisting = async (email: string) =>
    await client.user.findUnique({
      where: { email },
      select: {
        accountStatus: true,
        emailVerified: true,
        id: true,
        role: true
      }
    })

  const resolveExisting = (
    existing: Awaited<ReturnType<typeof readExisting>>,
    referenceDigest: string
  ): AdminProvisioningResult | null => {
    if (!existing) {
      return null
    }

    if (
      existing.role === 'ADMIN' &&
      existing.accountStatus === 'ACTIVE' &&
      existing.emailVerified
    ) {
      return {
        outcome: 'ALREADY_PROVISIONED',
        referenceDigest,
        userId: existing.id
      }
    }

    throw new AdminProvisioningError(
      existing.role === 'ADMIN'
        ? 'INVALID_EXISTING_ADMIN'
        : 'EXISTING_NON_ADMIN_ACCOUNT'
    )
  }

  const provision = async (
    input: AdminProvisioningInput
  ): Promise<AdminProvisioningResult> => {
    const email = input.email.trim().toLowerCase()
    const name = input.name.trim()
    const referenceDigest = getReferenceDigest(input.reference)
    if (name.length < 1 || name.length > 80) {
      throw new AdminProvisioningError('ACCOUNT_CREATION_FAILED')
    }
    const existingResult = resolveExisting(
      await readExisting(email),
      referenceDigest
    )
    if (existingResult) return existingResult

    let passwordHash: string
    try {
      passwordHash = await hashPassword(input.password)
    } catch {
      throw new AdminProvisioningError('ACCOUNT_CREATION_FAILED')
    }

    const userId = createUserId()
    try {
      await client.$transaction(async (transaction) => {
        await transaction.user.create({
          data: {
            id: userId,
            accountStatus: 'ACTIVE',
            email,
            emailVerified: true,
            name,
            role: 'ADMIN',
            ...(input.targetLevel ? { targetLevel: input.targetLevel } : {})
          }
        })
        await transaction.account.create({
          data: {
            accountId: userId,
            password: passwordHash,
            providerId: 'credential',
            userId
          }
        })
      })
    } catch {
      const racedResult = resolveExisting(
        await readExisting(email),
        referenceDigest
      )
      if (racedResult) return racedResult
      throw new AdminProvisioningError('ACCOUNT_CREATION_FAILED')
    }

    return {
      outcome: 'CREATED',
      referenceDigest,
      userId
    }
  }

  return { provision }
}

export type AdminProvisioner = ReturnType<typeof createAdminProvisioner>
