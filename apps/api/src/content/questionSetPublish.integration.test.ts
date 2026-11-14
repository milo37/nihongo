import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createPrismaAdminQuestionWorkflowRepository } from '../admin/adminQuestionWorkflowRepository.js'
import { createPrismaAdminQuestionCommandRepository } from '../admin/adminQuestionCommandRepository.js'
import {
  createAdminQuestionCommandService,
  createAdminQuestionPublicationCommandService,
  createAdminQuestionWorkflowCommandService
} from '../admin/adminQuestionCommandService.js'
import { createOperatorAdminAuthority } from '../admin/operatorAdminAuthority.js'
import { parseApiEnvironment } from '../config/env.js'
import { createDatabaseRuntime } from '../db/database.js'
import { assertSafeTestDatabase } from '../db/databaseTargetGuard.js'
import { eraseTestUser } from '../../test/fixtures/db/accountErasure.js'
import {
  questionImportDirectory,
  questionImportFileNames
} from '../../prisma/questionImportFiles.js'
import { contentFingerprint } from '../admin/adminQuestionWorkflowImport.js'
import { parseTagList, planTagLoad, type TagRow } from './tagList.js'
import {
  publishExplanationJa,
  readExplanationJaFile,
  type ExplanationJaFile
} from './explanationJaPublish.js'
import {
  publishQuestionSet,
  readQuestionSet,
  type QuestionSetFile
} from './questionSetPublish.js'

const environment = parseApiEnvironment(process.env)
assertSafeTestDatabase({
  nodeEnvironment: environment.NODE_ENV,
  databaseUrl: environment.DATABASE_URL,
  productionDatabaseUrl: process.env.PRODUCTION_DATABASE_URL
})
const fixtureDatabaseUrl = process.env.API_INTEGRATION_FIXTURE_DATABASE_URL
if (!fixtureDatabaseUrl)
  throw new Error('Question set integration requires the fixture database.')
assertSafeTestDatabase({
  nodeEnvironment: environment.NODE_ENV,
  databaseUrl: fixtureDatabaseUrl,
  productionDatabaseUrl: process.env.PRODUCTION_DATABASE_URL
})

const database = createDatabaseRuntime(environment.DATABASE_URL, {
  migrationProfile: 'current',
  startupRole: 'nihongo_app'
})
const fixtureDatabase = createDatabaseRuntime(fixtureDatabaseUrl)
const tagListFile = fileURLToPath(
  new URL('../../../../content/taxonomy/tags.v2.json', import.meta.url)
)
const explanationJaFile = fileURLToPath(
  new URL(
    '../../../../content/translations/explanations-ja.v1.json',
    import.meta.url
  )
)

let files: QuestionSetFile[] = []
let adminId = ''

const createAdmin = async (): Promise<string> => {
  const id = randomUUID()
  await fixtureDatabase.client.$transaction(async (fixture) => {
    await fixture.user.create({
      data: {
        id,
        email: `question-set-${randomUUID().slice(0, 8)}@example.test`,
        emailVerified: true,
        name: 'Question set admin',
        role: 'ADMIN'
      }
    })
    await fixture.account.create({
      data: {
        accountId: id,
        password: 'test-fixture-password-hash',
        providerId: 'credential',
        userId: id
      }
    })
  })
  return id
}

const contentRowCounts = async () => {
  const [questions, versions, audits, reviews] = await Promise.all([
    database.client.question.count(),
    database.client.questionVersion.count(),
    database.client.adminAuditLog.count(),
    database.client.contentReview.count()
  ])
  return { questions, versions, audits, reviews }
}

const run = (execute: boolean, runId?: string) =>
  publishQuestionSet({
    auditEnvironment: 'TEST',
    client: database.client,
    execute,
    files,
    ...(runId ? { runId } : {})
  })

beforeAll(async () => {
  files = await readQuestionSet(questionImportDirectory)
  expect(files.map(({ name }) => name)).toEqual(questionImportFileNames)
})

afterAll(async () => {
  await Promise.all([database.disconnect(), fixtureDatabase.disconnect()])
})

describe.sequential('question set publish operator command (JLP-828)', () => {
  it('refuses to run without an ACTIVE ADMIN', async () => {
    await expect(run(false)).rejects.toMatchObject({
      code: 'QUESTION_SET_ACTOR_INVALID'
    })
    adminId = await createAdmin()
  })

  it('writes nothing when a tag is unknown, even with confirmation', async () => {
    const before = await contentRowCounts()
    const report = await run(true)
    expect(report.issues.length).toBeGreaterThan(0)
    expect(report.issues.every(({ code }) => code === 'UNKNOWN_TAG')).toBe(true)
    expect(report.imported).toBe(0)
    expect(await contentRowCounts()).toEqual(before)

    // The 18 tags of tags.v2.json are the set's prerequisite.
    const list = parseTagList(await readFile(tagListFile))
    expect(list.tags).toHaveLength(18)
    // Like the tag list load: claim the seed's unkeyed tags of the same name.
    const plan = planTagLoad(
      list,
      await fixtureDatabase.client.$queryRawUnsafe<TagRow[]>(
        `SELECT "id"::text AS "id", "key", "label", "normalizedName",
           "subject"::text AS "subject", "status"::text AS "status", "labelJa"
         FROM "Tag" ORDER BY "id"`
      )
    )
    expect(plan.conflicts).toEqual([])
    for (const step of plan.steps) {
      const data = {
        key: step.tag.key,
        label: step.tag.label,
        normalizedName: step.tag.normalizedName,
        subject: step.tag.subject,
        status: step.tag.status,
        labelJa: step.tag.labelJa
      }
      if (step.kind === 'create')
        await fixtureDatabase.client.tag.create({ data })
      else
        await fixtureDatabase.client.tag.update({
          where: { id: step.id },
          data
        })
    }
    // #976: every tag of the list carries its Japanese name.
    expect(
      await database.client.tag.count({
        where: { key: { not: null }, labelJa: { not: null } }
      })
    ).toBe(18)
  })

  it('plans without writing on a dry run', async () => {
    const before = await contentRowCounts()
    const report = await run(false)
    expect(report).toMatchObject({
      execute: false,
      items: 500,
      pending: {
        IMPORT: 500,
        REVIEW_REQUEST: 0,
        APPROVAL: 0,
        PUBLICATION: 0
      },
      imported: 0,
      published: 0,
      skippedPublished: 0,
      conflicts: [],
      issues: [],
      failures: []
    })
    expect(report.files).toHaveLength(10)
    expect(await contentRowCounts()).toEqual(before)
  })

  it('refuses two ACTIVE ADMINs', async () => {
    const second = await createAdmin()
    try {
      await expect(run(true)).rejects.toMatchObject({
        code: 'QUESTION_SET_ACTOR_INVALID'
      })
    } finally {
      await eraseTestUser(database.client, second)
    }
  })

  it('finishes a set left half done and audits every step as the admin', async () => {
    // An earlier run stopped after importing one file, requesting review for
    // 20 of it and approving 10 of those.
    const authority = createOperatorAdminAuthority({
      actorId: adminId,
      requestId: randomUUID()
    })
    const commandRepository = createPrismaAdminQuestionCommandRepository({
      auditEnvironment: 'TEST',
      client: database.client
    })
    const commands = {
      ...createAdminQuestionCommandService(commandRepository),
      ...createAdminQuestionWorkflowCommandService(
        createPrismaAdminQuestionWorkflowRepository({
          auditEnvironment: 'TEST',
          client: database.client
        })
      )
    }
    const first = files[0]
    if (!first) throw new Error('The first set file is required.')
    const validation = await commands.validateImport({
      items: [...first.items]
    })
    const applied = await commands.applyImport(authority, {
      importId: randomUUID(),
      validationDigest: validation.validationDigest,
      items: [...first.items]
    })
    const requested = await commands.requestReviewBatch(authority, {
      items: applied.response.items.slice(0, 20).map((item) => ({
        versionId: item.questionVersionId,
        expectedRowVersion: 1
      }))
    })
    await commands.approveVersionBatch(authority, {
      items: requested.items.slice(0, 10).map((item) => ({
        questionVersionId: item.questionVersionId as string,
        expectedRowVersion: item.versionRowVersion as number
      }))
    })
    expect((await run(false)).pending).toEqual({
      IMPORT: 450,
      REVIEW_REQUEST: 30,
      APPROVAL: 10,
      PUBLICATION: 10
    })

    const runId = randomUUID()
    const report = await run(true, runId)
    expect(report).toMatchObject({
      execute: true,
      imported: 450,
      reviewRequested: 480,
      approved: 490,
      published: 500,
      skippedPublished: 0,
      failures: []
    })
    const audits = await database.client.adminAuditLog.groupBy({
      by: ['command', 'actorUserId'],
      where: { requestId: runId },
      _count: { _all: true }
    })
    expect(
      Object.fromEntries(
        audits.map((row) => [
          `${row.command}:${row.actorUserId === adminId}`,
          row._count._all
        ])
      )
    ).toMatchObject({
      'IMPORT_APPLY:true': 9,
      'APPROVAL:true': 490,
      'PUBLICATION:true': 500
    })
    const published = await database.client.questionVersion.count({
      where: {
        status: 'PUBLISHED',
        createdByUserId: adminId
      }
    })
    expect(published).toBe(500)
  }, 300_000)

  it('skips the published set on a rerun', async () => {
    const before = await contentRowCounts()
    const report = await run(true)
    expect(report).toMatchObject({
      imported: 0,
      reviewRequested: 0,
      approved: 0,
      published: 0,
      skippedPublished: 500,
      conflicts: [],
      failures: []
    })
    expect(await contentRowCounts()).toEqual(before)
  }, 120_000)
})

describe.sequential(
  'Japanese explanation publish operator command (#976)',
  () => {
    const explain = (
      items: ExplanationJaFile['items'],
      execute: boolean,
      runId?: string
    ) =>
      publishExplanationJa({
        auditEnvironment: 'TEST',
        client: database.client,
        execute,
        explanations: { sha256: '0'.repeat(64), items },
        files,
        ...(runId ? { runId } : {})
      })
    const setItem = (index: number) => {
      const item = files.flatMap((file) => file.items)[index]
      if (!item) throw new Error('The set item is required.')
      return item
    }
    const questionOf = async (index: number) => {
      const version = await database.client.questionVersion.findFirstOrThrow({
        where: {
          contentFingerprint: contentFingerprint(setItem(index).content)
        },
        select: { questionId: true }
      })
      return database.client.question.findUniqueOrThrow({
        where: { id: version.questionId },
        select: { id: true, rowVersion: true, currentPublishedVersionId: true }
      })
    }

    it('plans a new version for every question of the file without writing', async () => {
      const before = await contentRowCounts()
      const file = await readExplanationJaFile(explanationJaFile)
      const report = await publishExplanationJa({
        auditEnvironment: 'TEST',
        client: database.client,
        execute: false,
        explanations: file,
        files
      })
      expect(report).toMatchObject({
        items: 500,
        pending: {
          CREATE: 500,
          REVIEW_REQUEST: 0,
          APPROVAL: 0,
          PUBLICATION: 0
        },
        skippedPublished: 0,
        conflicts: [],
        failures: []
      })
      expect(await contentRowCounts()).toEqual(before)
    })

    it('writes nothing when an item is not in the set, even with confirmation', async () => {
      const before = await contentRowCounts()
      const report = await explain(
        [
          { clientItemId: setItem(0).clientItemId, explanationJa: '解説' },
          { clientItemId: 'not-in-the-set', explanationJa: '解説' }
        ],
        true
      )
      expect(report.conflicts).toEqual([
        { clientItemId: 'not-in-the-set', reason: 'NOT_IN_QUESTION_SET' }
      ])
      expect(report.created).toBe(0)
      expect(await contentRowCounts()).toEqual(before)
    })

    it('publishes a new version with only the Japanese explanation changed', async () => {
      const before = await questionOf(1)
      const runId = randomUUID()
      const items = [
        {
          clientItemId: setItem(1).clientItemId,
          explanationJa: '一つ目の解説'
        },
        { clientItemId: setItem(2).clientItemId, explanationJa: '二つ目の解説' }
      ]
      const report = await explain(items, true, runId)
      expect(report).toMatchObject({
        created: 2,
        reviewRequested: 2,
        approved: 2,
        published: 2,
        conflicts: [],
        failures: []
      })
      const after = await questionOf(1)
      expect(after.currentPublishedVersionId).not.toBe(
        before.currentPublishedVersionId
      )
      const [previous, next] = await Promise.all(
        [before.currentPublishedVersionId, after.currentPublishedVersionId].map(
          (id) =>
            database.client.questionVersion.findUniqueOrThrow({
              where: { id: id as string },
              include: { options: { orderBy: { ordinal: 'asc' } } }
            })
        )
      )
      expect(next).toMatchObject({
        versionNumber: previous!.versionNumber + 1,
        explanationJa: '一つ目の解説',
        explanationKo: previous!.explanationKo,
        questionText: previous!.questionText,
        contentFingerprint: previous!.contentFingerprint
      })
      expect(next!.options.map(({ text }) => text)).toEqual(
        previous!.options.map(({ text }) => text)
      )
      const audits = await database.client.adminAuditLog.groupBy({
        by: ['command'],
        where: { requestId: runId },
        _count: { _all: true }
      })
      expect(
        Object.fromEntries(audits.map((row) => [row.command, row._count._all]))
      ).toMatchObject({ QUESTION_VERSION_CREATE: 2, PUBLICATION: 2 })

      const counts = await contentRowCounts()
      expect(await explain(items, true)).toMatchObject({
        created: 0,
        published: 0,
        skippedPublished: 2,
        conflicts: []
      })
      expect(await contentRowCounts()).toEqual(counts)
    }, 120_000)

    it('leaves a question an admin reordered since the import to a person', async () => {
      const question = await questionOf(4)
      const authority = createOperatorAdminAuthority({
        actorId: adminId,
        requestId: randomUUID()
      })
      const repository = createPrismaAdminQuestionCommandRepository({
        auditEnvironment: 'TEST',
        client: database.client
      })
      const commands = {
        ...createAdminQuestionCommandService(repository),
        ...createAdminQuestionPublicationCommandService(repository),
        ...createAdminQuestionWorkflowCommandService(
          createPrismaAdminQuestionWorkflowRepository({
            auditEnvironment: 'TEST',
            client: database.client
          })
        )
      }
      const content = setItem(4).content
      // Same fingerprint: only the option order changes.
      const created = await commands.createVersion(authority, question.id, {
        ...content,
        options: content.options.toReversed(),
        expectedQuestionRowVersion: question.rowVersion
      } as Parameters<typeof commands.createVersion>[2])
      const versionId = created.questionVersionId as string
      const requested = await commands.requestReviewBatch(authority, {
        items: [{ versionId, expectedRowVersion: 1 }]
      })
      const approved = await commands.approveVersionBatch(authority, {
        items: [
          {
            questionVersionId: versionId,
            expectedRowVersion: requested.items[0]!.versionRowVersion as number
          }
        ]
      })
      await commands.publishVersionBatch(authority, {
        items: [
          {
            questionVersionId: versionId,
            expectedRowVersion: approved.items[0]!.rowVersion as number
          }
        ]
      })
      expect((await questionOf(4)).currentPublishedVersionId).toBe(versionId)

      const counts = await contentRowCounts()
      const clientItemId = setItem(4).clientItemId
      const report = await explain(
        [{ clientItemId, explanationJa: '並べ替えた後の解説' }],
        true
      )
      expect(report.conflicts).toEqual([
        { clientItemId, reason: 'PUBLISHED_CONTENT_CHANGED' }
      ])
      expect(await contentRowCounts()).toEqual(counts)
    }, 120_000)

    it('continues an open version with the same text and leaves another to a person', async () => {
      const question = await questionOf(3)
      const commands = createAdminQuestionCommandService(
        createPrismaAdminQuestionCommandRepository({
          auditEnvironment: 'TEST',
          client: database.client
        })
      )
      await commands.createVersion(
        createOperatorAdminAuthority({
          actorId: adminId,
          requestId: randomUUID()
        }),
        question.id,
        {
          ...setItem(3).content,
          explanationJa: '途中の解説',
          expectedQuestionRowVersion: question.rowVersion
        } as Parameters<typeof commands.createVersion>[2]
      )
      const clientItemId = setItem(3).clientItemId
      const counts = await contentRowCounts()
      const other = await explain(
        [{ clientItemId, explanationJa: '別の解説' }],
        true
      )
      expect(other.conflicts).toEqual([
        { clientItemId, reason: 'OPEN_VERSION_DRAFT' }
      ])
      expect(await contentRowCounts()).toEqual(counts)

      const same = await explain(
        [{ clientItemId, explanationJa: '途中の解説' }],
        true
      )
      expect(same).toMatchObject({
        pending: { CREATE: 0, REVIEW_REQUEST: 1 },
        created: 0,
        reviewRequested: 1,
        approved: 1,
        published: 1,
        failures: []
      })
    }, 120_000)
  }
)
