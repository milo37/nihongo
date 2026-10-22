import 'dotenv/config'
import { hashPassword } from 'better-auth/crypto'
import { z } from 'zod'
import { createAdminProvisioner } from './adminProvisioning.js'
import { parseApiEnvironment } from '../config/env.js'
import { createDatabaseRuntime } from '../db/database.js'

const commandInputSchema = z
  .object({
    email: z.email(),
    name: z.string().trim().min(1).max(80),
    password: z.string().min(12).max(128),
    reference: z.string().trim().min(3).max(128),
    targetLevel: z.enum(['N5', 'N4', 'N3', 'N2', 'N1']).optional()
  })
  .strict()

const run = async (): Promise<void> => {
  const environment = parseApiEnvironment(process.env)
  const input = commandInputSchema.parse({
    email: process.env.ADMIN_EMAIL,
    name: process.env.ADMIN_NAME,
    password: process.env.ADMIN_PASSWORD,
    reference: process.env.ADMIN_PROVISIONING_REFERENCE,
    targetLevel: process.env.ADMIN_TARGET_LEVEL || undefined
  })
  const database = createDatabaseRuntime(environment.DATABASE_URL)

  try {
    await database.checkReadiness()
    const provisioner = createAdminProvisioner({
      client: database.client,
      hashPassword
    })
    const { targetLevel, ...requiredInput } = input
    const result = await provisioner.provision({
      ...requiredInput,
      ...(targetLevel ? { targetLevel } : {})
    })

    process.stdout.write(
      `${JSON.stringify({
        event: 'auth.admin.provisioned',
        outcome: result.outcome,
        referenceDigest: result.referenceDigest,
        userId: result.userId
      })}\n`
    )
  } finally {
    await database.disconnect()
  }
}

void run().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({
      event: 'auth.admin.provisioning_failed',
      errorName: error instanceof Error ? error.name : 'UnknownError'
    })}\n`
  )
  process.exitCode = 1
})
