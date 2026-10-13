import { randomBytes, randomUUID } from 'node:crypto'
import { PrismaPg } from '@prisma/adapter-pg'
import { hashPassword } from 'better-auth/crypto'
import {
  createPostgresStartupOptions,
  getPostgresSchema
} from '../db/databaseOptions.js'
import { PrismaClient } from '../generated/prisma/client.js'
import { createPrismaStudySubmissionRepository } from '../study/studySubmissionRepository.js'
import { createStudySubmissionService } from '../study/studySubmissionService.js'

const DAY_MS = 24 * 60 * 60 * 1_000
const FIXTURE_QUERY_TIMEOUT_MS = 15_000
const FIXTURE_TRANSACTION_TIMEOUT_MS = 20_000

interface BrowserFixtureDatabase {
  readonly client: PrismaClient
  readonly disconnect: () => Promise<void>
}

interface BrowserUserFixture {
  readonly email: string
  readonly name: string
  readonly password: string
  readonly userId: string
}

interface BrowserQuestionFixture {
  readonly correctOptionId: string
  readonly correctOptionOrdinal: number
  readonly incorrectOptionId: string
  readonly incorrectOptionOrdinal: number
  readonly level: 'N4' | 'N5'
  readonly questionId: string
  readonly questionText: string
  readonly questionVersionId: string
  readonly tags: readonly string[]
}

const questionFixtures = {
  archived: {
    correctOptionId: 'd34583f8-bef9-4afe-87a4-dc3e0d2b6bbe',
    correctOptionOrdinal: 4,
    incorrectOptionId: '89ba806e-4980-4cf3-8360-3c9f0ffb1acf',
    incorrectOptionOrdinal: 1,
    level: 'N4',
    questionId: 'c639f3d6-a855-4a30-866b-642356aa47e6',
    questionText: '音楽を 聞き（　）、料理を しました。',
    questionVersionId: 'a57d4f4c-4642-4a54-8a8d-52ef5c1944c2',
    tags: ['동시 동작', 'ながら']
  },
  firstReview: {
    correctOptionId: '6530e61f-0bff-43ba-81d7-fe63bce86f02',
    correctOptionOrdinal: 2,
    incorrectOptionId: '6a27ff14-bf4f-4827-8c2c-f4f7db262fc3',
    incorrectOptionOrdinal: 1,
    level: 'N5',
    questionId: '02afbcba-d480-4de8-80a1-813313aee06e',
    questionText: '図書館（　）本を 読みます。',
    questionVersionId: 'c728e50e-a17d-456e-86b1-4c8f6ed0805e',
    tags: ['조사', '장소']
  },
  secondReview: {
    correctOptionId: 'd7f87247-a548-44fb-8f20-603c7283eb47',
    correctOptionOrdinal: 3,
    incorrectOptionId: '893bf486-1ecc-42a5-813c-0b46891e849d',
    incorrectOptionOrdinal: 1,
    level: 'N5',
    questionId: '02afbfba-d480-4301-8a22-7242eb1b7bf1',
    questionText: 'つくえの 上に 本（　）あります。',
    questionVersionId: '17536004-882c-498c-8034-79c97d496466',
    tags: ['존재문', '조사']
  },
  solved: {
    correctOptionId: '658f3b99-0c61-45e0-8595-cfd0ba5b9cec',
    correctOptionOrdinal: 3,
    incorrectOptionId: '392d1cb5-6cc7-410e-817e-4d9dc695c096',
    incorrectOptionOrdinal: 1,
    level: 'N4',
    questionId: 'c639f6d6-a855-4f49-821f-f72e2ed15fa9',
    questionText: '毎日 練習して、漢字が 読める（　）なりました。',
    questionVersionId: 'c23f5e3b-ae6b-4ea5-8871-23df1c234cd7',
    tags: ['상태 변화', '가능형']
  }
} as const satisfies Record<string, BrowserQuestionFixture>

export interface Phase5BrowserFixture {
  readonly archivedMemo: string
  readonly archivedQuestion: BrowserQuestionFixture
  readonly expectedCounts: {
    readonly due: number
    readonly repeated: number
    readonly solved: number
    readonly total: number
    readonly unreviewed: number
  }
  readonly expectedAfterDailyCounts: {
    readonly due: number
    readonly repeated: number
    readonly solved: number
    readonly total: number
    readonly unreviewed: number
  }
  readonly expectedAfterTargetedCounts: {
    readonly due: number
    readonly repeated: number
    readonly solved: number
    readonly total: number
    readonly unreviewed: number
  }
  readonly filter: {
    readonly level: 'N5'
    readonly questionType: 'GRAMMAR_SELECT'
    readonly subject: 'GRAMMAR'
    readonly tag: string
  }
  readonly foreign: BrowserUserFixture
  readonly owner: BrowserUserFixture
  readonly reviewQuestions: readonly [
    BrowserQuestionFixture,
    BrowserQuestionFixture
  ]
  readonly solvedQuestion: BrowserQuestionFixture
}

const createUser = async (
  database: BrowserFixtureDatabase,
  schemaName: string,
  label: 'owner' | 'foreign'
): Promise<BrowserUserFixture> => {
  const suffix = schemaName.slice(-21, -5)
  const userId = randomUUID()
  const fixture = {
    email: `phase5-${label}-${suffix}@example.test`,
    name: label === 'owner' ? 'Phase 5 학습자' : 'Phase 5 다른 학습자',
    password: `Phase5-${label}-${randomBytes(16).toString('base64url')}!9a`,
    userId
  }
  const password = await hashPassword(fixture.password)

  await database.client.$transaction(async (transaction) => {
    await transaction.user.create({
      data: {
        accountStatus: 'ACTIVE',
        email: fixture.email,
        emailVerified: true,
        id: fixture.userId,
        name: fixture.name,
        role: 'USER',
        targetLevel: 'N5'
      }
    })
    await transaction.account.create({
      data: {
        accountId: fixture.userId,
        password,
        providerId: 'credential',
        userId: fixture.userId
      }
    })
  })

  return fixture
}

const submitQuestion = async (
  database: BrowserFixtureDatabase,
  ownerUserId: string,
  question: BrowserQuestionFixture,
  occurredAt: Date,
  isCorrect: boolean
): Promise<void> => {
  const studySessionQuestionId = randomUUID()
  const session = await database.client.$transaction(async (transaction) => {
    const created = await transaction.studySession.create({
      data: {
        actualCount: 1,
        expiresAt: new Date(occurredAt.getTime() + DAY_MS),
        level: question.level,
        mode: 'RANDOM',
        requestedCount: 1,
        startedAt: occurredAt,
        subject: 'GRAMMAR',
        usedFallback: false,
        userId: ownerUserId
      },
      select: { id: true }
    })
    await transaction.studySessionQuestion.create({
      data: {
        createdAt: occurredAt,
        id: studySessionQuestionId,
        ordinal: 1,
        questionId: question.questionId,
        questionVersionId: question.questionVersionId,
        studySessionId: created.id
      }
    })
    return created
  })
  const submissionRepository = createPrismaStudySubmissionRepository(
    database.client
  )
  await createStudySubmissionService(
    submissionRepository,
    () => new Date(occurredAt.getTime() + 100)
  ).submit(
    session.id,
    randomUUID(),
    {
      answers: [
        {
          elapsedSec: 1,
          selectedOptionId: isCorrect
            ? question.correctOptionId
            : question.incorrectOptionId,
          studySessionQuestionId
        }
      ],
      durationSec: 1
    },
    { kind: 'USER', userId: ownerUserId }
  )
}

export const createPhase5BrowserFixture = async (
  database: BrowserFixtureDatabase,
  schemaName: string
): Promise<Phase5BrowserFixture> => {
  const owner = await createUser(database, schemaName, 'owner')
  const foreign = await createUser(database, schemaName, 'foreign')
  const firstReviewQuestion = questionFixtures.firstReview
  const secondReviewQuestion = questionFixtures.secondReview
  const solvedQuestion = questionFixtures.solved
  const archivedQuestion = questionFixtures.archived
  const baseTime = Date.now()

  for (const expected of Object.values(questionFixtures)) {
    const actual = await database.client.question.findUnique({
      where: { id: expected.questionId },
      select: {
        currentPublishedVersionId: true,
        lifecycleStatus: true,
        currentPublishedVersion: {
          select: {
            correctOptionId: true,
            id: true,
            level: true,
            options: {
              orderBy: { ordinal: 'asc' },
              select: { id: true, ordinal: true }
            },
            questionText: true,
            questionType: true,
            status: true,
            subject: true,
            tags: {
              orderBy: { labelSnapshot: 'asc' },
              select: { labelSnapshot: true }
            }
          }
        }
      }
    })
    const version = actual?.currentPublishedVersion
    const incorrectOption = version?.options.find(
      ({ id }) => id === expected.incorrectOptionId
    )
    const correctOption = version?.options.find(
      ({ id }) => id === expected.correctOptionId
    )
    if (
      actual?.lifecycleStatus !== 'ACTIVE' ||
      actual.currentPublishedVersionId !== expected.questionVersionId ||
      version?.id !== expected.questionVersionId ||
      version.status !== 'PUBLISHED' ||
      version.level !== expected.level ||
      version.subject !== 'GRAMMAR' ||
      version.questionType !== 'GRAMMAR_SELECT' ||
      version.questionText !== expected.questionText ||
      version.correctOptionId !== expected.correctOptionId ||
      correctOption?.ordinal !== expected.correctOptionOrdinal ||
      incorrectOption?.ordinal !== expected.incorrectOptionOrdinal ||
      version.tags
        .map(({ labelSnapshot }) => labelSnapshot)
        .toSorted()
        .join() !== [...expected.tags].sort().join()
    ) {
      throw new Error(
        `Phase 5 browser question catalog drifted for ${expected.questionId}.`
      )
    }
  }

  await submitQuestion(
    database,
    owner.userId,
    firstReviewQuestion,
    new Date(baseTime - 2 * DAY_MS),
    false
  )
  await submitQuestion(
    database,
    owner.userId,
    secondReviewQuestion,
    new Date(baseTime - 2 * DAY_MS + 1_000),
    false
  )

  for (let index = 0; index < 19; index += 1) {
    await submitQuestion(
      database,
      owner.userId,
      solvedQuestion,
      new Date(baseTime - (31 - index) * DAY_MS),
      false
    )
  }
  await submitQuestion(
    database,
    owner.userId,
    solvedQuestion,
    new Date(baseTime - 12 * DAY_MS),
    true
  )
  await submitQuestion(
    database,
    owner.userId,
    solvedQuestion,
    new Date(baseTime - 9 * DAY_MS),
    true
  )

  await submitQuestion(
    database,
    owner.userId,
    archivedQuestion,
    new Date(baseTime - 6 * DAY_MS),
    false
  )
  const archivedWrongNote = await database.client.wrongNote.findUniqueOrThrow({
    where: {
      userId_questionId: {
        questionId: archivedQuestion.questionId,
        userId: owner.userId
      }
    },
    select: { id: true }
  })
  const archivedMemo = 'Slice 6 보관 메모'
  await database.client.userMemo.create({
    data: {
      createdAt: new Date(baseTime - 5 * DAY_MS),
      text: archivedMemo,
      updatedAt: new Date(baseTime - 5 * DAY_MS),
      wrongNoteId: archivedWrongNote.id
    }
  })
  await database.client.$transaction(async (transaction) => {
    await transaction.question.update({
      where: { id: archivedQuestion.questionId },
      data: { currentPublishedVersionId: null }
    })
    await transaction.questionVersion.update({
      where: { id: archivedQuestion.questionVersionId },
      data: {
        retiredAt: new Date(baseTime - DAY_MS),
        status: 'RETIRED'
      }
    })
    await transaction.question.update({
      where: { id: archivedQuestion.questionId },
      data: {
        archivedAt: new Date(baseTime - DAY_MS),
        lifecycleStatus: 'ARCHIVED'
      }
    })
  })

  const facts = await Promise.all([
    database.client.studySession.count({ where: { userId: owner.userId } }),
    database.client.reviewEvent.count({ where: { userId: owner.userId } }),
    database.client.wrongNote.count({ where: { userId: owner.userId } }),
    database.client.reviewSchedule.count({
      where: { wrongNote: { userId: owner.userId } }
    }),
    database.client.userMemo.count({
      where: { wrongNote: { userId: owner.userId } }
    })
  ])
  if (facts.join(',') !== '24,24,4,4,1') {
    throw new Error(`Phase 5 browser facts are incomplete: ${facts.join(',')}`)
  }

  return {
    archivedMemo,
    archivedQuestion,
    expectedAfterDailyCounts: {
      due: 1,
      repeated: 2,
      solved: 1,
      total: 1,
      unreviewed: 0
    },
    expectedAfterTargetedCounts: {
      due: 1,
      repeated: 2,
      solved: 2,
      total: 1,
      unreviewed: 0
    },
    expectedCounts: {
      due: 3,
      repeated: 1,
      solved: 1,
      total: 3,
      unreviewed: 2
    },
    filter: {
      level: 'N5',
      questionType: 'GRAMMAR_SELECT',
      subject: 'GRAMMAR',
      tag: '조사'
    },
    foreign,
    owner,
    reviewQuestions: [firstReviewQuestion, secondReviewQuestion],
    solvedQuestion
  }
}

export const createPhase5BrowserFixtureDatabase = (
  connectionString: string
): BrowserFixtureDatabase => {
  const schema = getPostgresSchema(connectionString)
  const adapter = new PrismaPg(
    {
      connectionString,
      connectionTimeoutMillis: 3_000,
      idleTimeoutMillis: 30_000,
      max: 10,
      options: createPostgresStartupOptions(schema),
      query_timeout: FIXTURE_QUERY_TIMEOUT_MS,
      statement_timeout: FIXTURE_QUERY_TIMEOUT_MS
    },
    schema ? { schema } : {}
  )
  const client = new PrismaClient({
    adapter,
    transactionOptions: {
      maxWait: FIXTURE_QUERY_TIMEOUT_MS,
      timeout: FIXTURE_TRANSACTION_TIMEOUT_MS
    }
  })

  return {
    client,
    disconnect: () => client.$disconnect()
  }
}
