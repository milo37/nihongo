import { createHash } from 'node:crypto'
import type { Prisma, PrismaClient } from '../src/generated/prisma/client.js'
import {
  buildQuestionAggregateSeed,
  SEED_TIMESTAMP,
  type QuestionAggregateSeed
} from './seed-data/buildQuestionSeed.js'
import { QUESTION_CONTENT_REVIEW } from './seed-data/contentReview.js'
import { toStableSeedUuid } from './seed-data/id.js'
import { originalQuestionSeeds } from './seed-data/questions/index.js'

const EXPECTED_QUESTION_COUNT = 65
const EXPECTED_OPTION_COUNT = 260

export const buildAllQuestionSeeds = (): readonly QuestionAggregateSeed[] => {
  const contentHash = createHash('sha256')
    .update(JSON.stringify(originalQuestionSeeds))
    .digest('hex')

  if (contentHash !== QUESTION_CONTENT_REVIEW.sha256) {
    throw new Error(
      'Question content changed without an updated editorial review record.'
    )
  }

  const aggregates = originalQuestionSeeds.map((seed) =>
    buildQuestionAggregateSeed(seed, toStableSeedUuid)
  )
  const questionIds = new Set(aggregates.map(({ questionId }) => questionId))
  const versionIds = new Set(aggregates.map(({ versionId }) => versionId))
  const optionIds = new Set(
    aggregates.flatMap(({ options }) => options.map(({ id }) => id))
  )

  if (
    aggregates.length !== EXPECTED_QUESTION_COUNT ||
    questionIds.size !== EXPECTED_QUESTION_COUNT ||
    versionIds.size !== EXPECTED_QUESTION_COUNT ||
    optionIds.size !== EXPECTED_OPTION_COUNT
  ) {
    throw new Error('Question seed identity invariant failed.')
  }

  return aggregates
}

const toComparableVersion = (
  version: NonNullable<
    Awaited<ReturnType<typeof getSeededQuestion>>
  >['versions'][number]
) => ({
  id: version.id,
  questionId: version.questionId,
  versionNumber: version.versionNumber,
  level: version.level,
  subject: version.subject,
  questionType: version.questionType,
  passage: version.passage,
  questionText: version.questionText,
  correctOptionId: version.correctOptionId,
  explanationKo: version.explanationKo,
  explanationJa: version.explanationJa,
  difficulty: version.difficulty,
  sourceType: version.sourceType,
  createdByUserId: version.createdByUserId,
  createdByLabelSnapshot: version.createdByLabelSnapshot,
  createdAt: version.createdAt.toISOString(),
  publishedAt: version.publishedAt?.toISOString() ?? null,
  options: version.options.map(({ id, label, ordinal, text }) => ({
    id,
    label,
    ordinal,
    text
  })),
  tags: version.tags
    .map(({ id, labelSnapshot, tagId, tag }) => ({
      id,
      labelSnapshot,
      tagId,
      normalizedName: tag.normalizedName
    }))
    .toSorted((left, right) => left.id.localeCompare(right.id))
})

const toExpectedVersion = (seed: QuestionAggregateSeed) => ({
  id: seed.versionId,
  questionId: seed.questionId,
  versionNumber: 1,
  level: seed.level,
  subject: seed.subject,
  questionType: seed.questionType,
  passage: seed.passage,
  questionText: seed.questionText,
  correctOptionId: seed.correctOptionId,
  explanationKo: seed.explanationKo,
  explanationJa: seed.explanationJa,
  difficulty: seed.difficulty,
  sourceType: 'ORIGINAL',
  createdByUserId: null,
  createdByLabelSnapshot: 'SYSTEM_SEED',
  createdAt: SEED_TIMESTAMP.toISOString(),
  publishedAt: SEED_TIMESTAMP.toISOString(),
  options: seed.options.map(({ id, label, ordinal, text }) => ({
    id,
    label,
    ordinal,
    text
  })),
  tags: seed.tags
    .map(({ id: tagId, label, normalizedName, versionTagId: id }) => ({
      id,
      labelSnapshot: label,
      tagId,
      normalizedName
    }))
    .toSorted((left, right) => left.id.localeCompare(right.id))
})

const getSeededQuestion = (
  client: PrismaClient | Prisma.TransactionClient,
  questionId: string
) =>
  client.question.findUnique({
    where: { id: questionId },
    include: {
      versions: {
        where: { versionNumber: 1 },
        include: {
          options: { orderBy: { ordinal: 'asc' } },
          tags: { include: { tag: true } }
        }
      }
    }
  })

export const verifyExistingQuestionSeed = async (
  client: PrismaClient | Prisma.TransactionClient,
  seed: QuestionAggregateSeed
): Promise<void> => {
  const existing = await getSeededQuestion(client, seed.questionId)
  const version = existing?.versions.find(({ id }) => id === seed.versionId)

  if (!existing || !version) {
    throw new Error(`Question seed is partially present: ${seed.legacyId}`)
  }

  if (
    (version.status !== 'PUBLISHED' && version.status !== 'RETIRED') ||
    existing.createdByUserId !== null ||
    existing.createdByLabelSnapshot !== 'SYSTEM_SEED' ||
    existing.createdAt.toISOString() !== SEED_TIMESTAMP.toISOString()
  ) {
    throw new Error(`Question seed provenance is invalid: ${seed.legacyId}`)
  }

  if (
    JSON.stringify(toComparableVersion(version)) !==
    JSON.stringify(toExpectedVersion(seed))
  ) {
    throw new Error(
      `Published question seed differs from canonical content: ${seed.legacyId}`
    )
  }
}

const ensureCanonicalTag = async (
  transaction: Prisma.TransactionClient,
  tag: QuestionAggregateSeed['tags'][number]
): Promise<void> => {
  const existing = await transaction.tag.findUnique({
    where: { normalizedName: tag.normalizedName }
  })

  if (existing) {
    if (existing.id !== tag.id) {
      throw new Error(`Canonical tag identity mismatch: ${tag.label}`)
    }

    return
  }

  await transaction.tag.create({
    data: {
      id: tag.id,
      label: tag.label,
      normalizedName: tag.normalizedName,
      createdAt: SEED_TIMESTAMP,
      updatedAt: SEED_TIMESTAMP
    }
  })
}

const insertQuestionSeed = async (
  transaction: Prisma.TransactionClient,
  seed: QuestionAggregateSeed
): Promise<void> => {
  await transaction.question.create({
    data: {
      id: seed.questionId,
      lifecycleStatus: 'ACTIVE',
      createdByLabelSnapshot: 'SYSTEM_SEED',
      createdAt: SEED_TIMESTAMP,
      updatedAt: SEED_TIMESTAMP
    }
  })
  await transaction.questionVersion.create({
    data: {
      id: seed.versionId,
      questionId: seed.questionId,
      versionNumber: 1,
      status: 'DRAFT',
      level: seed.level,
      subject: seed.subject,
      questionType: seed.questionType,
      passage: seed.passage,
      questionText: seed.questionText,
      explanationKo: seed.explanationKo,
      explanationJa: seed.explanationJa,
      difficulty: seed.difficulty,
      sourceType: 'ORIGINAL',
      rowVersion: 1,
      createdByLabelSnapshot: 'SYSTEM_SEED',
      createdAt: SEED_TIMESTAMP,
      updatedAt: SEED_TIMESTAMP
    }
  })
  await transaction.questionOption.createMany({
    data: seed.options.map(({ id, label, ordinal, text }) => ({
      id,
      questionVersionId: seed.versionId,
      label,
      ordinal,
      text
    }))
  })

  for (const tag of seed.tags) {
    await ensureCanonicalTag(transaction, tag)
  }

  await transaction.questionVersionTag.createMany({
    data: seed.tags.map(({ id: tagId, label, versionTagId: id }) => ({
      id,
      questionVersionId: seed.versionId,
      tagId,
      labelSnapshot: label
    }))
  })
  await transaction.questionVersion.update({
    where: { id: seed.versionId },
    data: {
      correctOptionId: seed.correctOptionId,
      status: 'PUBLISHED',
      publishedAt: SEED_TIMESTAMP,
      updatedAt: SEED_TIMESTAMP
    }
  })
  await transaction.question.update({
    where: { id: seed.questionId },
    data: {
      currentPublishedVersionId: seed.versionId,
      updatedAt: SEED_TIMESTAMP
    }
  })
}

export interface SeedQuestionCatalogResult {
  insertedCount: number
  verifiedCount: number
}

export const seedQuestionCatalog = async (
  client: PrismaClient
): Promise<SeedQuestionCatalogResult> => {
  let insertedCount = 0
  let verifiedCount = 0

  for (const seed of buildAllQuestionSeeds()) {
    const existing = await client.question.findUnique({
      where: { id: seed.questionId },
      select: { id: true }
    })

    if (existing) {
      await verifyExistingQuestionSeed(client, seed)
      verifiedCount += 1
      continue
    }

    await client.$transaction(
      async (transaction) => insertQuestionSeed(transaction, seed),
      { isolationLevel: 'Serializable' }
    )
    insertedCount += 1
  }

  return { insertedCount, verifiedCount }
}
