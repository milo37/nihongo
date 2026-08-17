import { afterAll, describe, expect, it } from 'vitest'
import { createApiApp } from '../app/createApp.js'
import { parseApiEnvironment } from '../config/env.js'
import { createJsonLogger } from '../observability/logger.js'
import { createPrismaQuestionRepository } from '../question/questionRepository.js'
import { createQuestionService } from '../question/questionService.js'
import { createDatabaseRuntime } from './database.js'
import { assertSafeTestDatabase } from './databaseTargetGuard.js'

const environment = parseApiEnvironment(process.env)
assertSafeTestDatabase({
  nodeEnvironment: environment.NODE_ENV,
  databaseUrl: environment.DATABASE_URL,
  productionDatabaseUrl: process.env.PRODUCTION_DATABASE_URL
})

const database = createDatabaseRuntime(environment.DATABASE_URL)
const app = createApiApp({
  checkReadiness: database.checkReadiness,
  logger: createJsonLogger('silent'),
  questionReader: createQuestionService(
    createPrismaQuestionRepository(database.client)
  )
})

afterAll(async () => {
  await database.disconnect()
})

describe('database readiness', () => {
  it('PostgreSQL 연결과 baseline migration 적용을 확인한다', async () => {
    await expect(database.checkReadiness()).resolves.toBeUndefined()
  })

  it('application pool의 PostgreSQL session timezone을 UTC로 고정한다', async () => {
    const rows = await database.client.$queryRaw<{ timezone: string }[]>`
      SELECT current_setting('TimeZone') AS timezone`

    expect(rows).toEqual([{ timezone: 'UTC' }])
  })

  it('non-UTC local session에서도 UTC 자정 경계 bucket을 바꾸지 않는다', async () => {
    const buckets = await database.client.$transaction(async (transaction) => {
      await transaction.$executeRaw`SET LOCAL TIME ZONE 'Asia/Tokyo'`
      return await transaction.$queryRaw<{ bucket: string }[]>`
        SELECT TO_CHAR(boundary.value AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS bucket
        FROM (
          VALUES
            (TIMESTAMPTZ '2026-08-10 23:59:59.999+00'),
            (TIMESTAMPTZ '2026-08-11 00:00:00.000+00')
        ) AS boundary(value)
        ORDER BY boundary.value`
    })

    expect(buckets).toEqual([
      { bucket: '2026-08-10' },
      { bucket: '2026-08-11' }
    ])
  })

  it('실제 PostgreSQL을 사용하는 ready route가 200을 반환한다', async () => {
    const response = await app.request('/health/ready')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ready' })
  })
})
