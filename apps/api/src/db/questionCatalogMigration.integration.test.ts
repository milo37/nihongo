import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseApiEnvironment } from '../config/env.js'
import { assertSafeTestDatabase } from './databaseTargetGuard.js'

const MIGRATION_NAMES = [
  '20260814113000_phase3_question_catalog',
  '20260814120000_phase3_question_catalog_integrity',
  '20260814120500_phase3_seed_provenance_guard',
  '20260814121000_phase3_seed_provenance_backfill',
  '20260814122000_phase3_seed_provenance_constraints',
  '20260814123000_phase3_seed_provenance_guard_cleanup'
] as const

const readMigration = (name: (typeof MIGRATION_NAMES)[number]): string =>
  readFileSync(
    fileURLToPath(
      new URL(`../../prisma/migrations/${name}/migration.sql`, import.meta.url)
    ),
    'utf8'
  )

const environment = parseApiEnvironment(process.env)
assertSafeTestDatabase({
  nodeEnvironment: environment.NODE_ENV,
  databaseUrl: environment.DATABASE_URL,
  productionDatabaseUrl: process.env.PRODUCTION_DATABASE_URL
})

const schemaName = `slice1_upgrade_${randomUUID().replaceAll('-', '')}`
const quotedSchemaName = `"${schemaName}"`
const client = new Client({ connectionString: environment.DATABASE_URL })

const questionId = randomUUID()
const versionId = randomUUID()
const optionIds = Array.from({ length: 4 }, () => randomUUID())
const tagId = randomUUID()

beforeAll(async () => {
  await client.connect()
  await client.query(`CREATE SCHEMA ${quotedSchemaName}`)
  await client.query(`SET search_path TO ${quotedSchemaName}`)
})

afterAll(async () => {
  await client.query('SET search_path TO public')
  await client.query(`DROP SCHEMA IF EXISTS ${quotedSchemaName} CASCADE`)
  await client.end()
})

describe('question catalog legacy migration chain', () => {
  it('기존 published row를 안전하게 backfill하고 provenance를 강제한다', async () => {
    await client.query(readMigration(MIGRATION_NAMES[0]))

    await client.query(
      `INSERT INTO "Question" ("id", "updatedAt") VALUES ($1, NOW())`,
      [questionId]
    )
    await client.query(
      `INSERT INTO "QuestionVersion" (
        "id", "questionId", "versionNumber", "level", "subject",
        "questionType", "questionText", "explanationKo", "difficulty",
        "sourceType", "updatedAt"
      ) VALUES ($1, $2, 1, 'N5', 'VOCABULARY', 'KANJI_READING',
        '移行前の問題', '이관 전 해설', 'EASY', 'ORIGINAL', NOW())`,
      [versionId, questionId]
    )

    for (const [index, optionId] of optionIds.entries()) {
      const ordinal = index + 1
      await client.query(
        `INSERT INTO "QuestionOption" (
          "id", "questionVersionId", "label", "text", "ordinal"
        ) VALUES ($1, $2, $3, $4, $5)`,
        [optionId, versionId, String(ordinal), `보기 ${ordinal}`, ordinal]
      )
    }

    await client.query(
      `INSERT INTO "Tag" (
        "id", "label", "normalizedName", "updatedAt"
      ) VALUES ($1, '이관 태그', '이관 태그', NOW())`,
      [tagId]
    )
    await client.query(
      `INSERT INTO "QuestionVersionTag" (
        "id", "questionVersionId", "tagId", "labelSnapshot"
      ) VALUES ($1, $2, $3, '이관 태그')`,
      [randomUUID(), versionId, tagId]
    )
    await client.query(
      `UPDATE "QuestionVersion"
       SET "correctOptionId" = $1, "status" = 'PUBLISHED',
           "publishedAt" = NOW()
       WHERE "id" = $2`,
      [optionIds[0], versionId]
    )
    await client.query(
      `UPDATE "Question"
       SET "currentPublishedVersionId" = $1
       WHERE "id" = $2`,
      [versionId, questionId]
    )

    await client.query(readMigration(MIGRATION_NAMES[1]))
    await client.query(readMigration(MIGRATION_NAMES[2]))

    await client.query(
      `ALTER TABLE "QuestionVersion"
       DISABLE TRIGGER "QuestionVersion_validate_change"`
    )
    await expect(
      client.query(
        `UPDATE "QuestionVersion"
         SET "questionText" = '허용되지 않는 변경'
         WHERE "id" = $1`,
        [versionId]
      )
    ).rejects.toThrow()
    await client.query(
      `ALTER TABLE "QuestionVersion"
       ENABLE TRIGGER "QuestionVersion_validate_change"`
    )

    await client.query(readMigration(MIGRATION_NAMES[3]))
    await client.query(readMigration(MIGRATION_NAMES[4]))
    await client.query(readMigration(MIGRATION_NAMES[5]))

    const provenance = await client.query<{
      questionSnapshot: string
      versionSnapshot: string
    }>(
      `SELECT
        question."createdByLabelSnapshot"::text AS "questionSnapshot",
        version."createdByLabelSnapshot"::text AS "versionSnapshot"
       FROM "Question" AS question
       JOIN "QuestionVersion" AS version
         ON version."questionId" = question."id"
       WHERE question."id" = $1`,
      [questionId]
    )
    const nullableColumns = await client.query<{ isNullable: string }>(
      `SELECT is_nullable AS "isNullable"
       FROM information_schema.columns
       WHERE table_schema = $1
         AND table_name IN ('Question', 'QuestionVersion')
         AND column_name = 'createdByLabelSnapshot'
       ORDER BY table_name`,
      [schemaName]
    )
    const validationTriggers = await client.query<{
      name: string
      enabled: string
    }>(
      `SELECT tgname AS name, tgenabled AS enabled
       FROM pg_trigger
       WHERE tgrelid = '"QuestionVersion"'::regclass
         AND tgname LIKE 'QuestionVersion_validate%'
         AND NOT tgisinternal
       ORDER BY tgname`
    )

    expect(provenance.rows).toEqual([
      {
        questionSnapshot: 'SYSTEM_SEED',
        versionSnapshot: 'SYSTEM_SEED'
      }
    ])
    expect(nullableColumns.rows).toEqual([
      { isNullable: 'NO' },
      { isNullable: 'NO' }
    ])
    expect(validationTriggers.rows).toEqual([
      { name: 'QuestionVersion_validate_change', enabled: 'O' }
    ])
    await expect(
      client.query(
        `INSERT INTO "Question" ("id", "updatedAt") VALUES ($1, NOW())`,
        [randomUUID()]
      )
    ).rejects.toThrow()
  })
})
