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

  it('실제 PostgreSQL을 사용하는 ready route가 200을 반환한다', async () => {
    const response = await app.request('/health/ready')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ready' })
  })
})
