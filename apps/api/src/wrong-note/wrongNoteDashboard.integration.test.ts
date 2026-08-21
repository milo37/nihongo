import { randomUUID } from 'node:crypto'
import { compareWrongNoteTagLabels } from '@nihongo/contracts/wrong-note/list-wrong-notes'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseApiEnvironment } from '../config/env.js'
import { createDashboardService } from '../dashboard/dashboardService.js'
import { createPrismaDashboardRepository } from '../dashboard/dashboardRepository.js'
import { createDatabaseRuntime } from '../db/database.js'
import { assertSafeTestDatabase } from '../db/databaseTargetGuard.js'
import {
  createPrismaStudySessionRepository,
  type ExistingStudyOwner
} from '../study/studySessionRepository.js'
import { createPrismaStudySubmissionRepository } from '../study/studySubmissionRepository.js'
import { createStudySubmissionService } from '../study/studySubmissionService.js'
import { createPrismaWrongNoteRepository } from './wrongNoteRepository.js'
import {
  createWrongNoteQuestionPreview,
  toWrongNoteDetail
} from './wrongNoteMapper.js'
import { createWrongNoteService } from './wrongNoteService.js'

const DAY_MILLISECONDS = 24 * 60 * 60 * 1_000

const environment = parseApiEnvironment(process.env)
assertSafeTestDatabase({
  nodeEnvironment: environment.NODE_ENV,
  databaseUrl: environment.DATABASE_URL,
  productionDatabaseUrl: process.env.PRODUCTION_DATABASE_URL
})

const database = createDatabaseRuntime(environment.DATABASE_URL)
const sessionRepository = createPrismaStudySessionRepository(database.client)
const submissionRepository = createPrismaStudySubmissionRepository(
  database.client
)
const wrongNoteRepository = createPrismaWrongNoteRepository(database.client)
const wrongNoteService = createWrongNoteService(wrongNoteRepository)
const dashboardService = createDashboardService(
  createPrismaDashboardRepository(database.client),
  () => new Date('2026-08-16T23:59:59.999Z')
)

interface SubmittedFixture {
  readonly correct: boolean
  readonly mode: 'RANDOM' | 'WRONG_NOTE'
  readonly questionId: string
  readonly sessionId: string
  readonly subject: 'VOCABULARY' | 'GRAMMAR' | 'READING'
  readonly submittedAt: Date
  readonly userId: string
}

interface QuestionRestoreState {
  readonly archivedAt: Date | null
  readonly currentPublishedVersionId: string | null
  readonly lifecycleStatus: 'ACTIVE' | 'ARCHIVED'
  readonly questionId: string
}

interface TagRestoreState {
  readonly label: string
  readonly normalizedName: string
  readonly tagId: string
}

const createdUserIds = new Set<string>()
const submittedFixtures: SubmittedFixture[] = []
let questionRestoreState: QuestionRestoreState | null = null
let tagRestoreState: TagRestoreState | null = null

const createUser = async (label: string): Promise<string> => {
  const user = await database.client.user.create({
    data: {
      name: `Slice 5 ${label}`,
      email: `slice5-${label}-${randomUUID()}@example.test`,
      emailVerified: true
    },
    select: { id: true }
  })
  createdUserIds.add(user.id)
  return user.id
}

const submitRandomSession = async (
  owner: ExistingStudyOwner,
  subject: SubmittedFixture['subject'],
  submittedAt: Date,
  correct: boolean
): Promise<SubmittedFixture> => {
  if (owner.kind !== 'USER') {
    throw new Error('Slice 5 dashboard fixture requires a USER owner.')
  }
  const startedAt = new Date(submittedAt.getTime() - 1_000)
  const created = await sessionRepository.createRandom({
    level: 'N5',
    subject,
    owner,
    requestedCount: 1,
    startedAt,
    expiresAt: new Date(startedAt.getTime() + DAY_MILLISECONDS)
  })
  const material = await database.client.studySessionQuestion.findFirstOrThrow({
    where: { studySessionId: created.session.id },
    select: {
      id: true,
      questionId: true,
      questionVersion: { select: { correctOptionId: true } }
    }
  })
  if (!material.questionVersion.correctOptionId) {
    throw new Error('Published question fixture has no correct option.')
  }
  const service = createStudySubmissionService(
    submissionRepository,
    () => new Date(submittedAt)
  )
  await service.submit(
    created.session.id,
    randomUUID(),
    {
      answers: [
        {
          studySessionQuestionId: material.id,
          selectedOptionId: correct
            ? material.questionVersion.correctOptionId
            : null,
          elapsedSec: 10
        }
      ],
      durationSec: 10
    },
    owner
  )

  const fixture = {
    correct,
    mode: 'RANDOM',
    questionId: material.questionId,
    sessionId: created.session.id,
    subject,
    submittedAt,
    userId: owner.userId
  } satisfies SubmittedFixture
  submittedFixtures.push(fixture)
  return fixture
}

const submitWrongNoteSession = async (
  owner: Extract<ExistingStudyOwner, { kind: 'USER' }>,
  submittedAt: Date
): Promise<SubmittedFixture> => {
  const startedAt = new Date(submittedAt.getTime() - 1_000)
  const created = await sessionRepository.create({
    level: 'N5',
    subject: 'VOCABULARY',
    mode: 'WRONG_NOTE',
    owner,
    requestedCount: 1,
    practiceContractVersion: 2,
    startedAt,
    expiresAt: new Date(startedAt.getTime() + DAY_MILLISECONDS)
  })
  const material = await database.client.studySessionQuestion.findFirstOrThrow({
    where: { studySessionId: created.session.id },
    select: { id: true, questionId: true }
  })
  await createStudySubmissionService(
    submissionRepository,
    () => submittedAt
  ).submit(
    created.session.id,
    randomUUID(),
    {
      answers: [
        {
          studySessionQuestionId: material.id,
          selectedOptionId: null,
          elapsedSec: 0
        }
      ],
      durationSec: 0,
      expectedDraftRevision: 0
    },
    owner,
    2
  )
  const fixture = {
    correct: false,
    mode: 'WRONG_NOTE',
    questionId: material.questionId,
    sessionId: created.session.id,
    subject: 'VOCABULARY',
    submittedAt,
    userId: owner.userId
  } satisfies SubmittedFixture
  submittedFixtures.push(fixture)
  return fixture
}

const toSortedExactLabels = (labels: readonly string[]): string[] =>
  [...new Set(labels)].toSorted(compareWrongNoteTagLabels)

beforeAll(async () => {
  await database.checkReadiness()
})

afterAll(async () => {
  if (questionRestoreState) {
    await database.client.question.update({
      where: { id: questionRestoreState.questionId },
      data: {
        lifecycleStatus: questionRestoreState.lifecycleStatus,
        archivedAt: questionRestoreState.archivedAt,
        currentPublishedVersionId:
          questionRestoreState.currentPublishedVersionId
      }
    })
  }
  if (tagRestoreState) {
    await database.client.tag.update({
      where: { id: tagRestoreState.tagId },
      data: {
        label: tagRestoreState.label,
        normalizedName: tagRestoreState.normalizedName
      }
    })
  }
  if (createdUserIds.size > 0) {
    await database.client.user.deleteMany({
      where: { id: { in: [...createdUserIds] } }
    })
  }
  await database.disconnect()
})

describe.sequential('Slice 5 WrongNote/Dashboard PostgreSQL reads', () => {
  let ownerUserId: string
  let foreignUserId: string
  let outsiderUserId: string

  beforeAll(async () => {
    ownerUserId = await createUser('owner')
    foreignUserId = await createUser('foreign')
    outsiderUserId = await createUser('outsider')
    const owner = { kind: 'USER' as const, userId: ownerUserId }
    const plan = [
      ['VOCABULARY', '2026-08-10T23:59:59.999Z', false],
      ['VOCABULARY', '2026-08-11T00:00:00.000Z', false],
      ['VOCABULARY', '2026-08-12T01:00:00.000Z', true],
      ['GRAMMAR', '2026-08-13T01:00:00.000Z', false],
      ['GRAMMAR', '2026-08-14T01:00:00.000Z', true],
      ['GRAMMAR', '2026-08-15T01:00:00.000Z', true],
      ['READING', '2026-08-14T01:00:00.000Z', false],
      ['READING', '2026-08-15T01:00:00.000Z', false],
      ['READING', '2026-08-16T01:00:00.000Z', false]
    ] as const

    for (const [subject, submittedAt, correct] of plan) {
      await submitRandomSession(owner, subject, new Date(submittedAt), correct)
    }
    await submitWrongNoteSession(owner, new Date('2026-08-16T03:00:00.000Z'))
    await submitRandomSession(
      { kind: 'USER', userId: foreignUserId },
      'VOCABULARY',
      new Date('2026-08-16T02:00:00.000Z'),
      false
    )
  })

  it('exact historical tag filter는 mutable Tag rename과 owner isolation에 영향받지 않는다', async () => {
    const target = await database.client.wrongNote.findFirstOrThrow({
      where: { userId: ownerUserId },
      orderBy: [{ wrongCount: 'desc' }, { id: 'asc' }],
      select: {
        questionId: true,
        lastWrongQuestionVersion: {
          select: {
            tags: {
              orderBy: [{ labelSnapshot: 'asc' }, { tagId: 'asc' }],
              select: {
                labelSnapshot: true,
                tag: {
                  select: { id: true, label: true, normalizedName: true }
                }
              }
            }
          }
        }
      }
    })
    const historicalTag = target.lastWrongQuestionVersion.tags[0]
    if (!historicalTag) {
      throw new Error('Historical tag fixture is required.')
    }
    tagRestoreState = {
      tagId: historicalTag.tag.id,
      label: historicalTag.tag.label,
      normalizedName: historicalTag.tag.normalizedName
    }
    const renamedLabel = `renamed-${randomUUID()}`
    await database.client.tag.update({
      where: { id: historicalTag.tag.id },
      data: { label: renamedLabel, normalizedName: renamedLabel }
    })

    const exact = await wrongNoteService.listWrongNotes(ownerUserId, {
      page: 1,
      pageSize: 100,
      sort: 'RECENT',
      tag: historicalTag.labelSnapshot
    })
    const different = await wrongNoteService.listWrongNotes(ownerUserId, {
      page: 1,
      pageSize: 100,
      sort: 'RECENT',
      tag: `${historicalTag.labelSnapshot}-different`
    })
    const outsider = await wrongNoteService.listWrongNotes(outsiderUserId, {
      page: 1,
      pageSize: 100,
      sort: 'RECENT',
      tag: historicalTag.labelSnapshot
    })

    expect(
      exact.items.some(({ questionId }) => questionId === target.questionId)
    ).toBe(true)
    expect(exact.availableTags).toContain(historicalTag.labelSnapshot)
    expect(exact.availableTags).not.toContain(renamedLabel)
    expect(different.total).toBe(0)
    expect(outsider.total).toBe(0)
    expect(outsider.availableTags).toEqual([])
  })

  it('list pagination/sorts와 archived historical detail은 lastWrong version을 유지한다', async () => {
    const mostWrong = await wrongNoteService.listWrongNotes(ownerUserId, {
      page: 1,
      pageSize: 1,
      sort: 'MOST_WRONG'
    })
    const recent = await wrongNoteService.listWrongNotes(ownerUserId, {
      page: 1,
      pageSize: 100,
      sort: 'RECENT'
    })
    const oldest = await wrongNoteService.listWrongNotes(ownerUserId, {
      page: 1,
      pageSize: 100,
      sort: 'OLDEST'
    })
    const beyondLast = await wrongNoteService.listWrongNotes(ownerUserId, {
      page: Number.MAX_SAFE_INTEGER,
      pageSize: 100,
      sort: 'RECENT'
    })
    const target = mostWrong.items[0]
    if (!target) {
      throw new Error('WrongNote fixture is required.')
    }
    expect(mostWrong.items).toHaveLength(1)
    expect(mostWrong.total).toBeGreaterThan(1)
    expect(recent.items.map(({ lastWrongAt }) => lastWrongAt)).toEqual(
      recent.items
        .map(({ lastWrongAt }) => lastWrongAt)
        .toSorted()
        .toReversed()
    )
    expect(oldest.items.map(({ lastWrongAt }) => lastWrongAt)).toEqual(
      oldest.items.map(({ lastWrongAt }) => lastWrongAt).toSorted()
    )
    expect(beyondLast).toMatchObject({
      items: [],
      total: recent.total,
      availableTags: recent.availableTags
    })

    const originalQuestion = await database.client.question.findUniqueOrThrow({
      where: { id: target.questionId },
      select: {
        id: true,
        lifecycleStatus: true,
        archivedAt: true,
        currentPublishedVersionId: true
      }
    })
    questionRestoreState = {
      questionId: originalQuestion.id,
      lifecycleStatus: originalQuestion.lifecycleStatus,
      archivedAt: originalQuestion.archivedAt,
      currentPublishedVersionId: originalQuestion.currentPublishedVersionId
    }
    await database.client.question.update({
      where: { id: target.questionId },
      data: {
        lifecycleStatus: 'ARCHIVED',
        archivedAt: new Date('2026-08-16T03:00:00.000Z'),
        currentPublishedVersionId: null
      }
    })

    const rawDetail = await wrongNoteRepository.findOwnedDetail(
      ownerUserId,
      target.questionId
    )
    if (!rawDetail) {
      throw new Error('Owned detail fixture is required.')
    }
    const detail = toWrongNoteDetail(rawDetail)
    expect(detail.wrongNote.reviewAvailability).toBe('ARCHIVED')
    expect(detail.memo).toBeNull()
    expect(detail.currentReviewQuestionVersionId).toBe(
      detail.lastWrongQuestionVersionId
    )
    expect(detail.lastWrongQuestionVersionId).toBe(
      detail.question.questionVersionId
    )
    expect(detail.wrongNote).toMatchObject({
      questionId: detail.question.id,
      level: detail.question.level,
      subject: detail.question.subject,
      questionType: detail.question.questionType,
      questionPreview: createWrongNoteQuestionPreview(
        detail.question.questionText
      ),
      tags: toSortedExactLabels(detail.question.tags.map(({ label }) => label))
    })
    await expect(
      wrongNoteService.getWrongNote(outsiderUserId, target.questionId)
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' })
    await expect(
      wrongNoteService.getWrongNote(ownerUserId, randomUUID())
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' })
  })

  it('dashboard는 all-mode activity range와 all-time WrongNote snapshot을 분리한다', async () => {
    const storedUtcSessions = await database.client.$queryRaw<
      { id: string; submittedAtUtc: string }[]
    >`
      SELECT
        session."id",
        TO_CHAR(
          session."submittedAt" AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        ) AS "submittedAtUtc"
      FROM "StudySession" AS session
      WHERE session."userId" = ${ownerUserId}::uuid
        AND session."status" = 'SUBMITTED'::"StudySessionStatus"
        AND session."submittedAt" IS NOT NULL
      ORDER BY session."id"`
    expect(storedUtcSessions).toEqual(
      submittedFixtures
        .filter(({ userId }) => userId === ownerUserId)
        .map(({ sessionId, submittedAt }) => ({
          id: sessionId,
          submittedAtUtc: submittedAt.toISOString()
        }))
        .toSorted((left, right) => (left.id < right.id ? -1 : 1))
    )

    const full = await dashboardService.getDashboardStats(ownerUserId, {
      from: '2026-08-10',
      to: '2026-08-16'
    })
    const ranged = await dashboardService.getDashboardStats(ownerUserId, {
      from: '2026-08-14',
      to: '2026-08-16'
    })
    const foreign = await dashboardService.getDashboardStats(foreignUserId, {
      from: '2026-08-10',
      to: '2026-08-16'
    })
    const ownerNoteCounts = await database.client.wrongNote.groupBy({
      by: ['status'],
      where: { userId: ownerUserId },
      _count: { _all: true }
    })
    const totalNotes = ownerNoteCounts.reduce(
      (total, row) => total + row._count._all,
      0
    )
    const solvedNotes = ownerNoteCounts
      .filter(({ status }) => status === 'SOLVED')
      .reduce((total, row) => total + row._count._all, 0)

    expect(full).toMatchObject({
      totalAnsweredCount: 10,
      correctCount: 3,
      correctRate: 30,
      weakestSubject: 'READING',
      wrongNoteCount: totalNotes,
      solvedWrongNoteCount: solvedNotes
    })
    expect(full.subjectStats).toEqual([
      {
        subject: 'VOCABULARY',
        answeredCount: 4,
        correctCount: 1,
        correctRate: 25
      },
      {
        subject: 'GRAMMAR',
        answeredCount: 3,
        correctCount: 2,
        correctRate: 66.67
      },
      {
        subject: 'READING',
        answeredCount: 3,
        correctCount: 0,
        correctRate: 0
      }
    ])
    expect(full.dailyStudyCountLast7Days.map(({ count }) => count)).toEqual([
      1, 1, 1, 1, 2, 2, 2
    ])
    const expectedRecent = submittedFixtures
      .filter(({ userId }) => userId === ownerUserId)
      .toSorted(
        (left, right) =>
          right.submittedAt.getTime() - left.submittedAt.getTime() ||
          (left.sessionId < right.sessionId ? -1 : 1)
      )
      .slice(0, 5)
      .map(({ sessionId }) => sessionId)
    expect(full.recentStudySessions.map(({ id }) => id)).toEqual(expectedRecent)
    expect(
      full.recentStudySessions.find(
        ({ id }) =>
          id ===
          submittedFixtures.find(({ mode }) => mode === 'WRONG_NOTE')?.sessionId
      )?.mode
    ).toBe('WRONG_NOTE')
    expect(full.repeatedWrongQuestions).toHaveLength(Math.min(5, totalNotes))
    expect(ranged).toMatchObject({
      totalAnsweredCount: 6,
      correctCount: 2,
      correctRate: 33.33,
      wrongNoteCount: full.wrongNoteCount,
      solvedWrongNoteCount: full.solvedWrongNoteCount
    })
    expect(ranged.dailyStudyCountLast7Days.map(({ count }) => count)).toEqual([
      0, 0, 0, 0, 2, 2, 2
    ])
    expect(foreign).toMatchObject({
      totalAnsweredCount: 1,
      correctCount: 0,
      wrongNoteCount: 1
    })
    const foreignFixture = submittedFixtures.find(
      ({ userId }) => userId === foreignUserId
    )
    expect(foreign.recentStudySessions.map(({ id }) => id)).toEqual([
      foreignFixture?.sessionId
    ])
    expect(foreign.repeatedWrongQuestions).toHaveLength(1)
  })

  it('migration trim CHECK가 draft historical snapshot edge space를 거부한다', async () => {
    const questionId = randomUUID()
    const versionId = randomUUID()
    const tagId = randomUUID()
    await database.client.question.create({
      data: { id: questionId, createdByLabelSnapshot: 'SYSTEM_SEED' }
    })
    await database.client.questionVersion.create({
      data: {
        id: versionId,
        questionId,
        versionNumber: 1,
        level: 'N5',
        subject: 'VOCABULARY',
        questionType: 'KANJI_READING',
        questionText: 'trim constraint fixture',
        explanationKo: 'trim constraint fixture',
        difficulty: 'EASY',
        createdByLabelSnapshot: 'SYSTEM_SEED'
      }
    })
    await database.client.tag.create({
      data: {
        id: tagId,
        label: 'trim-check',
        normalizedName: `trim-check-${randomUUID()}`
      }
    })

    try {
      await expect(
        database.client.questionVersionTag.create({
          data: {
            questionVersionId: versionId,
            tagId,
            labelSnapshot: ' trim-check '
          }
        })
      ).rejects.toThrow()
    } finally {
      await database.client.question.delete({ where: { id: questionId } })
      await database.client.tag.delete({ where: { id: tagId } })
    }
  })
})
