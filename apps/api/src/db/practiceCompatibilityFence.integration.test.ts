import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createGuestPrincipalService } from '../auth/guestPrincipalService.js'
import { parseApiEnvironment } from '../config/env.js'
import { createPrismaStudySessionRepository } from '../study/studySessionRepository.js'
import { createStudySessionService } from '../study/studySessionService.js'
import { createPracticeRuntimeGate } from '../lifecycle/practiceRuntimeGate.js'
import { createDatabaseRuntime } from './database.js'
import { assertSafeTestDatabase } from './databaseTargetGuard.js'
import { PracticeCompatibilityFenceError } from './practiceCompatibilityFence.js'

const environment = parseApiEnvironment(process.env)
assertSafeTestDatabase({
  nodeEnvironment: environment.NODE_ENV,
  databaseUrl: environment.DATABASE_URL,
  productionDatabaseUrl: process.env.PRODUCTION_DATABASE_URL
})

const database = createDatabaseRuntime(environment.DATABASE_URL)
const guestPrincipalService = createGuestPrincipalService({
  client: database.client,
  secret: environment.GUEST_COOKIE_SECRET
})
const studySessionService = createStudySessionService(
  createPrismaStudySessionRepository(database.client)
)
const guestPrincipalIds = new Set<string>()
const userIds = new Set<string>()

afterEach(async () => {
  if (guestPrincipalIds.size > 0) {
    await database.client.guestPrincipal.deleteMany({
      where: { id: { in: [...guestPrincipalIds] } }
    })
    guestPrincipalIds.clear()
  }
  if (userIds.size > 0) {
    await database.client.user.deleteMany({
      where: { id: { in: [...userIds] } }
    })
    userIds.clear()
  }
})

afterAll(async () => {
  await database.disconnect()
})

describe('practice compatibility pre-listen fence', () => {
  it('zero facts만 허용하고 첫 v2 session 뒤에는 row 삭제 전까지 거부한다', async () => {
    const runtimeGate = createPracticeRuntimeGate({
      runtime: 'v1-compatible',
      authority: {
        generationLeaseId: '550e8400-e29b-41d4-a716-446655440000',
        assertValid: () => undefined
      },
      checkDatabaseReadiness: database.checkReadiness,
      checkV1Compatibility: database.checkV1Compatibility
    })
    await expect(runtimeGate.checkReadiness()).resolves.toBeUndefined()

    const credential = guestPrincipalService.prepareCredential()
    guestPrincipalIds.add(credential.id)
    await studySessionService.create(
      {
        level: 'N5',
        subject: 'VOCABULARY',
        mode: 'RANDOM',
        count: 1
      },
      { kind: 'NEW_GUEST', credential },
      2
    )

    await expect(database.checkV1Compatibility()).rejects.toBeInstanceOf(
      PracticeCompatibilityFenceError
    )
    await expect(runtimeGate.assertRequestAuthority()).rejects.toBeInstanceOf(
      PracticeCompatibilityFenceError
    )

    await database.client.guestPrincipal.delete({
      where: { id: credential.id }
    })
    guestPrincipalIds.delete(credential.id)
    await expect(database.checkV1Compatibility()).resolves.toBeUndefined()
  })

  it('Bookmark fact 하나도 v1-compatible runtime을 fail-closed 처리한다', async () => {
    const runtimeGate = createPracticeRuntimeGate({
      runtime: 'v1-compatible',
      authority: {
        generationLeaseId: '550e8400-e29b-41d4-a716-446655440000',
        assertValid: () => undefined
      },
      checkDatabaseReadiness: database.checkReadiness,
      checkV1Compatibility: database.checkV1Compatibility
    })
    const user = await database.client.user.create({
      data: {
        email: `slice4-fence-${randomUUID()}@example.test`,
        emailVerified: true,
        name: 'Slice 4 fence'
      },
      select: { id: true }
    })
    userIds.add(user.id)
    const question = await database.client.question.findFirstOrThrow({
      where: {
        lifecycleStatus: 'ACTIVE',
        currentPublishedVersion: { is: { status: 'PUBLISHED' } }
      },
      orderBy: { id: 'asc' },
      select: { id: true }
    })

    await database.client.bookmark.create({
      data: {
        id: randomUUID(),
        userId: user.id,
        questionId: question.id
      }
    })

    await expect(database.checkV1Compatibility()).rejects.toBeInstanceOf(
      PracticeCompatibilityFenceError
    )
    await expect(runtimeGate.assertRequestAuthority()).rejects.toBeInstanceOf(
      PracticeCompatibilityFenceError
    )

    await database.client.bookmark.deleteMany({ where: { userId: user.id } })
    await expect(database.checkV1Compatibility()).resolves.toBeUndefined()
  })
})
