import {
  type AdminQuestionMutationResult,
  type CreateAdminQuestionRequest,
  type QuestionVersionStatus
} from '@nihongo/contracts/admin/phase7'
import { describe, expect, it, vi } from 'vitest'
import { mockSeedData } from '@mocks/data'
import { DEMO_ADMIN_ID, DEMO_REVIEWER_ADMIN_ID } from '@mocks/data/users'
import type { MockCanonicalAdminQuestionSource } from '@mocks/repository/mockDatabase'
import {
  MockPhase7AdminCmsState,
  MockPhase7AdminCommandError,
  type MockPhase7AdminCmsSnapshot,
  type MockPhase7LearnerPins
} from '@mocks/repository/phase7AdminCmsState'

const sourceQuestion = mockSeedData.questions[0]
if (!sourceQuestion) throw new Error('Phase 7 state test seed is unavailable.')

const sources: readonly MockCanonicalAdminQuestionSource[] = [
  { answerCount: 0, correctCount: 0, question: sourceQuestion }
]
const emptyPins: MockPhase7LearnerPins = {
  bookmarkedQuestionIds: [],
  studyResultQuestionVersionIds: [],
  studySessionQuestionVersionIds: [],
  wrongNotes: []
}

const createClock = (): (() => string) => {
  let tick = 0
  return () => {
    const value = new Date(Date.UTC(2026, 8, 15, 0, 0, tick)).toISOString()
    tick += 1
    return value
  }
}

const createState = (): MockPhase7AdminCmsState =>
  new MockPhase7AdminCmsState(createClock(), 'TEST')

const getQuestion = (
  snapshot: MockPhase7AdminCmsSnapshot,
  questionId?: string
) => {
  const question = questionId
    ? snapshot.questions.find(
        (candidate) => candidate.questionId === questionId
      )
    : snapshot.questions[0]
  if (!question) throw new Error('Phase 7 state test Question is unavailable.')
  return question
}

const requireVersionId = (result: AdminQuestionMutationResult): string => {
  if (!result.questionVersionId) {
    throw new Error('Phase 7 state test version ID is unavailable.')
  }
  return result.questionVersionId
}

const createContent = (suffix: string): CreateAdminQuestionRequest => {
  const correctIndex = sourceQuestion.options.findIndex(
    (option) => option.isCorrect
  )
  if (correctIndex < 0) throw new Error('Seed correct option is unavailable.')
  return {
    level: sourceQuestion.level,
    subject: sourceQuestion.subject,
    questionType: sourceQuestion.questionType,
    difficulty: sourceQuestion.difficulty,
    questionText: `${sourceQuestion.questionText}\n${suffix}`,
    passage: sourceQuestion.passage,
    explanationKo: sourceQuestion.explanationKo,
    explanationJa: sourceQuestion.explanationJa,
    tagNames: sourceQuestion.tags,
    options: sourceQuestion.options.map((option, index) => ({
      clientOptionKey: `option-${index + 1}`,
      text: option.text
    })),
    correctOptionKey: `option-${correctIndex + 1}`
  }
}

const createDuplicateSource = (
  suffix: string
): MockCanonicalAdminQuestionSource => ({
  answerCount: 0,
  correctCount: 0,
  question: {
    ...sourceQuestion,
    id: `phase7-duplicate-${crypto.randomUUID()}`,
    questionText: `${sourceQuestion.questionText}\n${suffix}`,
    options: sourceQuestion.options.map((option) => ({ ...option }))
  }
})

const advanceCandidate = async (
  state: MockPhase7AdminCmsState,
  versionId: string,
  initialRowVersion: number,
  target: Extract<
    QuestionVersionStatus,
    'APPROVED' | 'CHANGES_REQUESTED' | 'DRAFT' | 'IN_REVIEW'
  >
): Promise<number> => {
  if (target === 'DRAFT') return initialRowVersion
  const inReview = await state.transitionVersion({
    actorId: DEMO_ADMIN_ID,
    assertAuthority: () => undefined,
    operation: 'requestContentReview',
    request: { expectedRowVersion: initialRowVersion },
    requestId: crypto.randomUUID(),
    sources,
    versionId
  })
  if (target === 'IN_REVIEW') return inReview.versionRowVersion!
  const decision = await state.transitionVersion({
    actorId: DEMO_REVIEWER_ADMIN_ID,
    assertAuthority: () => undefined,
    operation:
      target === 'APPROVED'
        ? 'approveQuestionVersion'
        : 'requestQuestionChanges',
    request:
      target === 'APPROVED'
        ? { expectedRowVersion: inReview.versionRowVersion! }
        : {
            expectedRowVersion: inReview.versionRowVersion!,
            reason: 'CONTENT_RECHECK'
          },
    requestId: crypto.randomUUID(),
    sources,
    versionId
  })
  return decision.versionRowVersion!
}

const createCandidateForSeed = async (
  state: MockPhase7AdminCmsState,
  status: Extract<
    QuestionVersionStatus,
    'APPROVED' | 'CHANGES_REQUESTED' | 'DRAFT' | 'IN_REVIEW'
  >,
  suffix: string
) => {
  const initial = getQuestion(state.snapshot(sources))
  const created = await state.createVersion({
    actorId: DEMO_ADMIN_ID,
    assertAuthority: () => undefined,
    questionId: initial.questionId,
    request: {
      ...createContent(suffix),
      expectedQuestionRowVersion: initial.rowVersion
    },
    requestId: crypto.randomUUID(),
    sources
  })
  const versionId = requireVersionId(created)
  const versionRowVersion = await advanceCandidate(
    state,
    versionId,
    created.versionRowVersion!,
    status
  )
  return {
    questionId: created.questionId,
    questionRowVersion: created.questionRowVersion,
    versionId,
    versionRowVersion
  }
}

const createCandidateOnly = async (
  state: MockPhase7AdminCmsState,
  status: Extract<
    QuestionVersionStatus,
    'APPROVED' | 'CHANGES_REQUESTED' | 'DRAFT' | 'IN_REVIEW'
  >,
  suffix: string
) => {
  const created = await state.createQuestion({
    actorId: DEMO_ADMIN_ID,
    assertAuthority: () => undefined,
    request: createContent(suffix),
    requestId: crypto.randomUUID(),
    sources
  })
  const versionId = requireVersionId(created)
  const versionRowVersion = await advanceCandidate(
    state,
    versionId,
    created.versionRowVersion!,
    status
  )
  return {
    questionId: created.questionId,
    questionRowVersion: created.questionRowVersion,
    versionId,
    versionRowVersion
  }
}

describe('Phase 7 dormant publication MSW state', () => {
  it('publishes, retires and archives with exact learner pins and one concurrent winner', async () => {
    const state = createState()
    const initial = state.snapshot(sources)
    const question = getQuestion(initial)
    const seedVersionId = question.currentPublishedVersionId
    if (!seedVersionId)
      throw new Error('Seed published version is unavailable.')
    const seedVersion = initial.versions.find(
      (version) => version.questionVersionId === seedVersionId
    )
    if (!seedVersion) throw new Error('Seed version is unavailable.')
    const pins: MockPhase7LearnerPins = {
      bookmarkedQuestionIds: [question.questionId],
      studyResultQuestionVersionIds: [seedVersionId],
      studySessionQuestionVersionIds: [seedVersionId],
      wrongNotes: [
        {
          currentReviewQuestionVersionId: seedVersionId,
          lastWrongQuestionVersionId: seedVersionId,
          questionId: question.questionId
        }
      ]
    }
    const beforeLearner = state.getLearnerProjection(sources, pins)
    const candidate = await createCandidateForSeed(
      state,
      'APPROVED',
      'replacement publication'
    )
    const publishRequest = {
      expectedQuestionRowVersion: candidate.questionRowVersion,
      expectedRowVersion: candidate.versionRowVersion
    }
    const publishRequests = [crypto.randomUUID(), crypto.randomUUID()].map(
      (requestId) => ({
        requestId,
        outcome: state.publishQuestionVersion({
          actorId: DEMO_ADMIN_ID,
          assertAuthority: () => undefined,
          request: publishRequest,
          requestId,
          sources,
          versionId: candidate.versionId
        })
      })
    )
    const publishOutcomes = await Promise.allSettled(
      publishRequests.map(({ outcome }) => outcome)
    )
    const publishWinnerIndex = publishOutcomes.findIndex(
      (outcome) => outcome.status === 'fulfilled'
    )
    const publishLoserIndex = publishOutcomes.findIndex(
      (outcome) => outcome.status === 'rejected'
    )
    expect([publishWinnerIndex, publishLoserIndex]).not.toContain(-1)
    const publishWinner = publishOutcomes[publishWinnerIndex]
    const publishLoser = publishOutcomes[publishLoserIndex]
    if (
      publishWinner?.status !== 'fulfilled' ||
      publishLoser?.status !== 'rejected'
    ) {
      throw new Error('Publication winner/loser is unavailable.')
    }
    expect(publishWinner.value).toMatchObject({
      questionId: question.questionId,
      questionVersionId: candidate.versionId,
      questionRowVersion: candidate.questionRowVersion + 1,
      versionRowVersion: candidate.versionRowVersion + 1,
      versionStatus: 'PUBLISHED'
    })
    expect(publishLoser.reason).toMatchObject({
      code: 'VERSION_CONFLICT',
      disposition: 'DEFINITE_ROLLBACK'
    })

    const afterPublish = state.snapshot(sources)
    expect(
      afterPublish.auditLogs.filter(
        (audit) =>
          audit.requestId === publishRequests[publishLoserIndex]!.requestId
      )
    ).toEqual([])
    expect(
      afterPublish.reviews.filter(
        (review) =>
          review.requestId === publishRequests[publishLoserIndex]!.requestId
      )
    ).toEqual([])
    const publishedQuestion = getQuestion(afterPublish, question.questionId)
    expect(publishedQuestion).toMatchObject({
      currentPublishedVersionId: candidate.versionId,
      openCandidateVersionId: null,
      rowVersion: candidate.questionRowVersion + 1
    })
    const publishedVersion = afterPublish.versions.find(
      (version) => version.questionVersionId === candidate.versionId
    )
    const replacedSeed = afterPublish.versions.find(
      (version) => version.questionVersionId === seedVersionId
    )
    expect(publishedVersion).toMatchObject({
      versionStatus: 'PUBLISHED',
      rowVersion: candidate.versionRowVersion + 1,
      retirementKind: null,
      publishedAt: publishWinner.value.occurredAt
    })
    expect(replacedSeed).toMatchObject({
      versionStatus: 'RETIRED',
      rowVersion: seedVersion.rowVersion + 1,
      retirementKind: 'PUBLISHED_RETIREMENT',
      retiredAt: publishWinner.value.occurredAt
    })
    const winnerRequestId = publishRequests[publishWinnerIndex]!.requestId
    const publicationReviews = afterPublish.reviews.filter(
      (review) => review.requestId === winnerRequestId
    )
    expect(publicationReviews).toHaveLength(2)
    expect(publicationReviews).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'PUBLISHED',
          counterpart: expect.objectContaining({
            actorId: DEMO_REVIEWER_ADMIN_ID
          }),
          reason: null
        }),
        expect.objectContaining({
          action: 'RETIRED',
          counterpart: null,
          reason: 'PUBLISHED_REPLACEMENT'
        })
      ])
    )
    expect(
      new Set(publicationReviews.map(({ operationId }) => operationId))
    ).toHaveLength(1)
    expect(
      new Set(publicationReviews.map(({ occurredAt }) => occurredAt))
    ).toHaveLength(1)
    expect(
      afterPublish.auditLogs.find(
        (audit) => audit.requestId === winnerRequestId
      )
    ).toMatchObject({
      command: 'PUBLICATION',
      targetId: candidate.versionId,
      beforeState: 'APPROVED',
      afterState: 'PUBLISHED',
      changedFields: ['VERSION_STATUS', 'CURRENT_PUBLISHED_VERSION_ID'],
      contentDigest: expect.stringMatching(/^[0-9a-f]{64}$/u)
    })

    const learnerAfterPublish = state.getLearnerProjection(sources, pins)
    const publicReplacement = learnerAfterPublish.publicQuestions.find(
      (item) => item.id === question.questionId
    )
    expect(publicReplacement).toMatchObject({
      id: question.questionId,
      questionVersionId: candidate.versionId,
      questionText: publishedVersion?.questionText,
      options: publishedVersion?.options.map((option) =>
        expect.objectContaining({ id: option.id })
      )
    })
    expect(publicReplacement).not.toHaveProperty('correctOptionId')
    expect(publicReplacement).not.toHaveProperty('explanationKo')
    expect(
      learnerAfterPublish.practiceCandidates.find(
        (item) => item.id === question.questionId
      )?.questionVersionId
    ).toBe(candidate.versionId)
    expect(learnerAfterPublish.studySessionQuestions).toEqual(
      beforeLearner.studySessionQuestions
    )
    expect(learnerAfterPublish.studyResultQuestions).toEqual(
      beforeLearner.studyResultQuestions
    )
    expect(learnerAfterPublish.wrongNotes[0]).toMatchObject({
      currentReviewQuestionVersionId: seedVersionId,
      lastWrongQuestion: {
        question: { questionVersionId: seedVersionId }
      },
      reviewAvailability: 'AVAILABLE',
      reviewCandidate: { questionVersionId: candidate.versionId }
    })
    expect(learnerAfterPublish.bookmarks[0]).toMatchObject({
      availability: 'AVAILABLE',
      summaryVersionId: candidate.versionId
    })

    expect(getQuestion(state.snapshot([]), question.questionId)).toEqual(
      publishedQuestion
    )
    expect(getQuestion(state.snapshot(sources), question.questionId)).toEqual(
      publishedQuestion
    )

    const retireRequest = {
      expectedQuestionRowVersion: publishedQuestion.rowVersion,
      expectedRowVersion: publishedVersion!.rowVersion
    }
    const retireRequests = [crypto.randomUUID(), crypto.randomUUID()].map(
      (requestId) => ({
        requestId,
        outcome: state.retireQuestionVersion({
          actorId: DEMO_REVIEWER_ADMIN_ID,
          assertAuthority: () => undefined,
          request: retireRequest,
          requestId,
          sources,
          versionId: candidate.versionId
        })
      })
    )
    const retireOutcomes = await Promise.allSettled(
      retireRequests.map(({ outcome }) => outcome)
    )
    expect(
      retireOutcomes.filter(({ status }) => status === 'fulfilled')
    ).toHaveLength(1)
    const retireWinnerIndex = retireOutcomes.findIndex(
      ({ status }) => status === 'fulfilled'
    )
    const retireLoserIndex = retireOutcomes.findIndex(
      ({ status }) => status === 'rejected'
    )
    const retireWinner = retireOutcomes[retireWinnerIndex]
    const retireLoser = retireOutcomes[retireLoserIndex]
    if (
      retireWinner?.status !== 'fulfilled' ||
      retireLoser?.status !== 'rejected'
    ) {
      throw new Error('Retirement winner/loser is unavailable.')
    }
    expect(retireWinner.value).toMatchObject({
      questionId: question.questionId,
      questionVersionId: candidate.versionId,
      questionRowVersion: publishedQuestion.rowVersion + 1,
      versionRowVersion: publishedVersion!.rowVersion + 1,
      versionStatus: 'RETIRED'
    })
    expect(retireLoser.reason).toMatchObject({
      code: 'VERSION_CONFLICT',
      disposition: 'DEFINITE_ROLLBACK'
    })
    let retiredSnapshot = state.snapshot(sources)
    expect(
      retiredSnapshot.auditLogs.filter(
        (audit) =>
          audit.requestId === retireRequests[retireLoserIndex]!.requestId
      )
    ).toEqual([])
    expect(getQuestion(retiredSnapshot, question.questionId)).toMatchObject({
      lifecycleStatus: 'ACTIVE',
      currentPublishedVersionId: null,
      openCandidateVersionId: null,
      rowVersion: publishedQuestion.rowVersion + 1
    })
    expect(
      retiredSnapshot.versions.find(
        (version) => version.questionVersionId === candidate.versionId
      )
    ).toMatchObject({
      versionStatus: 'RETIRED',
      retirementKind: 'PUBLISHED_RETIREMENT',
      retiredAt: retireWinner.value.occurredAt,
      rowVersion: publishedVersion!.rowVersion + 1
    })
    const retireWinnerRequestId = retireRequests[retireWinnerIndex]!.requestId
    const retirementAudit = retiredSnapshot.auditLogs.find(
      (audit) => audit.requestId === retireWinnerRequestId
    )
    expect(retirementAudit).toMatchObject({
      command: 'RETIREMENT',
      targetId: candidate.versionId,
      beforeState: 'PUBLISHED',
      afterState: 'RETIRED',
      changedFields: ['VERSION_STATUS', 'CURRENT_PUBLISHED_VERSION_ID'],
      occurredAt: retireWinner.value.occurredAt
    })
    expect(
      retiredSnapshot.reviews.filter(
        (review) => review.requestId === retireWinnerRequestId
      )
    ).toEqual([
      expect.objectContaining({
        action: 'RETIRED',
        counterpart: null,
        fromState: 'PUBLISHED',
        toState: 'RETIRED',
        reason: 'PUBLISHED_RETIREMENT',
        operationId: retirementAudit?.operationId,
        occurredAt: retireWinner.value.occurredAt
      })
    ])
    const learnerAfterRetire = state.getLearnerProjection(sources, pins)
    expect(
      learnerAfterRetire.publicQuestions.some(
        (item) => item.id === question.questionId
      )
    ).toBe(false)
    expect(
      learnerAfterRetire.practiceCandidates.some(
        (item) => item.id === question.questionId
      )
    ).toBe(false)
    expect(learnerAfterRetire.studySessionQuestions).toEqual(
      beforeLearner.studySessionQuestions
    )
    expect(learnerAfterRetire.studyResultQuestions).toEqual(
      beforeLearner.studyResultQuestions
    )
    expect(learnerAfterRetire.wrongNotes[0]).toMatchObject({
      currentReviewQuestionVersionId: seedVersionId,
      reviewAvailability: 'ARCHIVED',
      reviewCandidate: null
    })
    expect(learnerAfterRetire.bookmarks[0]).toMatchObject({
      availability: 'ARCHIVED',
      summaryVersionId: candidate.versionId
    })

    const retiredQuestion = getQuestion(retiredSnapshot, question.questionId)
    const archiveRequest = {
      expectedQuestionRowVersion: retiredQuestion.rowVersion,
      expectedOpenCandidateVersionId: null,
      expectedOpenCandidateRowVersion: null
    }
    const archiveRequests = [crypto.randomUUID(), crypto.randomUUID()].map(
      (requestId) => ({
        requestId,
        outcome: state.archiveAdminQuestion({
          actorId: DEMO_ADMIN_ID,
          assertAuthority: () => undefined,
          questionId: question.questionId,
          request: archiveRequest,
          requestId,
          sources
        })
      })
    )
    const archiveOutcomes = await Promise.allSettled(
      archiveRequests.map(({ outcome }) => outcome)
    )
    expect(
      archiveOutcomes.filter(({ status }) => status === 'fulfilled')
    ).toHaveLength(1)
    const archiveLoserIndex = archiveOutcomes.findIndex(
      ({ status }) => status === 'rejected'
    )
    const archiveLoser = archiveOutcomes[archiveLoserIndex]
    if (archiveLoser?.status !== 'rejected') {
      throw new Error('Archive loser is unavailable.')
    }
    expect(archiveLoser.reason).toMatchObject({
      code: 'VERSION_CONFLICT',
      disposition: 'DEFINITE_ROLLBACK'
    })
    retiredSnapshot = state.snapshot([])
    const archived = getQuestion(retiredSnapshot, question.questionId)
    expect(archived).toMatchObject({
      lifecycleStatus: 'ARCHIVED',
      currentPublishedVersionId: null,
      openCandidateVersionId: null,
      archivedAt: expect.any(String),
      rowVersion: retiredQuestion.rowVersion + 1
    })
    expect(
      retiredSnapshot.auditLogs.filter(
        (audit) =>
          audit.requestId === archiveRequests[archiveLoserIndex]!.requestId
      )
    ).toEqual([])
    const archiveWinnerAudit = retiredSnapshot.auditLogs.find(
      (audit) => audit.command === 'QUESTION_ARCHIVE'
    )
    expect(archiveWinnerAudit).toMatchObject({
      changedFields: ['LIFECYCLE_STATUS'],
      metadata: {
        kind: 'QUESTION_ARCHIVE_V1',
        retiredPublishedCount: 0,
        abandonedCandidateCount: 0
      }
    })
    expect(archived.archivedAt).toBe(archiveWinnerAudit?.occurredAt)
    expect(
      retiredSnapshot.reviews.filter(
        (review) => review.operationId === archiveWinnerAudit?.operationId
      )
    ).toEqual([])
    expect(getQuestion(state.snapshot(sources), question.questionId)).toEqual(
      archived
    )
    const learnerAfterArchive = state.getLearnerProjection(sources, pins)
    expect(learnerAfterArchive).toMatchObject({
      bookmarks: [
        {
          availability: 'ARCHIVED',
          summaryVersionId: candidate.versionId
        }
      ],
      wrongNotes: [
        {
          currentReviewQuestionVersionId: seedVersionId,
          lastWrongQuestion: {
            question: { questionVersionId: seedVersionId }
          },
          reviewAvailability: 'ARCHIVED',
          reviewCandidate: null
        }
      ]
    })
    expect(learnerAfterArchive.publicQuestions).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: question.questionId })
      ])
    )
    expect(learnerAfterArchive.practiceCandidates).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: question.questionId })
      ])
    )
    expect(learnerAfterArchive.studySessionQuestions).toEqual(
      beforeLearner.studySessionQuestions
    )
    expect(learnerAfterArchive.studyResultQuestions).toEqual(
      beforeLearner.studyResultQuestions
    )
  })

  it('publishes an initial approved candidate without inventing replacement evidence', async () => {
    const state = createState()
    const candidate = await createCandidateOnly(
      state,
      'APPROVED',
      'initial publication'
    )
    const before = state.snapshot(sources)
    await expect(
      state.publishQuestionVersion({
        actorId: DEMO_ADMIN_ID,
        assertAuthority: () => undefined,
        request: {
          expectedQuestionRowVersion: candidate.questionRowVersion,
          expectedRowVersion: candidate.versionRowVersion + 1
        },
        requestId: crypto.randomUUID(),
        sources,
        versionId: candidate.versionId
      })
    ).rejects.toMatchObject({ code: 'VERSION_CONFLICT' })
    expect(state.snapshot(sources)).toEqual(before)

    const requestId = crypto.randomUUID()
    const result = await state.publishQuestionVersion({
      actorId: DEMO_ADMIN_ID,
      assertAuthority: () => undefined,
      request: {
        expectedQuestionRowVersion: candidate.questionRowVersion,
        expectedRowVersion: candidate.versionRowVersion
      },
      requestId,
      sources,
      versionId: candidate.versionId
    })
    expect(result).toMatchObject({
      questionId: candidate.questionId,
      questionVersionId: candidate.versionId,
      questionRowVersion: candidate.questionRowVersion + 1,
      versionRowVersion: candidate.versionRowVersion + 1,
      versionStatus: 'PUBLISHED'
    })
    const after = state.snapshot(sources)
    expect(getQuestion(after, candidate.questionId)).toMatchObject({
      currentPublishedVersionId: candidate.versionId,
      openCandidateVersionId: null,
      rowVersion: candidate.questionRowVersion + 1
    })
    expect(
      after.reviews.filter((review) => review.requestId === requestId)
    ).toEqual([
      expect.objectContaining({
        action: 'PUBLISHED',
        counterpart: expect.objectContaining({
          actorId: DEMO_REVIEWER_ADMIN_ID
        }),
        reason: null,
        occurredAt: result.occurredAt
      })
    ])
    expect(
      after.auditLogs.filter((audit) => audit.requestId === requestId)
    ).toEqual([
      expect.objectContaining({
        command: 'PUBLICATION',
        changedFields: ['VERSION_STATUS', 'CURRENT_PUBLISHED_VERSION_ID'],
        occurredAt: result.occurredAt
      })
    ])
    expect(
      state.getLearnerProjection(sources, emptyPins).publicQuestions
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: candidate.questionId,
          questionVersionId: candidate.versionId
        })
      ])
    )
  })

  it.each([
    ['DRAFT', true],
    ['IN_REVIEW', true],
    ['CHANGES_REQUESTED', true],
    ['APPROVED', true],
    ['DRAFT', false]
  ] as const)(
    'archives %s candidate with current=%s and exact conditional evidence',
    async (candidateStatus, hasCurrent) => {
      const state = createState()
      const candidate = hasCurrent
        ? await createCandidateForSeed(
            state,
            candidateStatus,
            `archive ${candidateStatus} with current`
          )
        : await createCandidateOnly(
            state,
            candidateStatus,
            `archive ${candidateStatus} candidate only`
          )
      const before = state.snapshot(sources)
      const currentId = getQuestion(
        before,
        candidate.questionId
      ).currentPublishedVersionId
      const currentBefore = currentId
        ? before.versions.find(
            (version) => version.questionVersionId === currentId
          )
        : undefined
      const requestId = crypto.randomUUID()
      const result = await state.archiveAdminQuestion({
        actorId: DEMO_REVIEWER_ADMIN_ID,
        assertAuthority: () => undefined,
        questionId: candidate.questionId,
        request: {
          expectedQuestionRowVersion: candidate.questionRowVersion,
          expectedOpenCandidateVersionId: candidate.versionId,
          expectedOpenCandidateRowVersion: candidate.versionRowVersion
        },
        requestId,
        sources
      })
      expect(result).toMatchObject({
        lifecycleStatus: 'ARCHIVED',
        questionId: candidate.questionId,
        questionRowVersion: candidate.questionRowVersion + 1,
        questionVersionId: null,
        versionRowVersion: null,
        versionStatus: null
      })
      const after = state.snapshot(sources)
      expect(getQuestion(after, candidate.questionId)).toMatchObject({
        lifecycleStatus: 'ARCHIVED',
        currentPublishedVersionId: null,
        openCandidateVersionId: null,
        archivedAt: result.occurredAt,
        rowVersion: candidate.questionRowVersion + 1
      })
      const archivedCandidate = after.versions.find(
        (version) => version.questionVersionId === candidate.versionId
      )
      expect(archivedCandidate).toMatchObject({
        versionStatus: 'RETIRED',
        retirementKind: 'QUESTION_ARCHIVE_ABANDONED',
        rowVersion: candidate.versionRowVersion + 1,
        publishedAt: null,
        retiredAt: result.occurredAt
      })
      if (currentId) {
        expect(
          after.versions.find(
            (version) => version.questionVersionId === currentId
          )
        ).toMatchObject({
          versionStatus: 'RETIRED',
          retirementKind: 'PUBLISHED_RETIREMENT',
          retiredAt: result.occurredAt,
          rowVersion: currentBefore!.rowVersion + 1
        })
      }
      const audit = after.auditLogs.find(
        (entry) => entry.requestId === requestId
      )
      expect(audit).toMatchObject({
        command: 'QUESTION_ARCHIVE',
        changedFields: hasCurrent
          ? [
              'LIFECYCLE_STATUS',
              'VERSION_STATUS',
              'CURRENT_PUBLISHED_VERSION_ID'
            ]
          : ['LIFECYCLE_STATUS', 'VERSION_STATUS'],
        metadata: {
          kind: 'QUESTION_ARCHIVE_V1',
          retiredPublishedCount: hasCurrent ? 1 : 0,
          abandonedCandidateCount: 1
        }
      })
      const reviews = after.reviews.filter(
        (review) => review.operationId === audit?.operationId
      )
      expect(reviews).toHaveLength(hasCurrent ? 2 : 1)
      expect(reviews).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: 'ARCHIVE_ABANDONED',
            fromState: candidateStatus,
            reason: 'QUESTION_ARCHIVE',
            counterpart: expect.objectContaining({ actorId: DEMO_ADMIN_ID })
          })
        ])
      )
      if (hasCurrent) {
        expect(reviews).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              action: 'RETIRED',
              fromState: 'PUBLISHED',
              toState: 'RETIRED',
              reason: 'QUESTION_ARCHIVE',
              counterpart: null
            })
          ])
        )
      }
      expect(new Set(reviews.map((review) => review.operationId))).toHaveLength(
        1
      )
      expect(new Set(reviews.map((review) => review.occurredAt))).toEqual(
        new Set([result.occurredAt])
      )
      expect(
        reviews.every((review) => review.operationId === audit?.operationId)
      ).toBe(true)
      expect(
        state
          .getLearnerProjection(sources, emptyPins)
          .publicQuestions.some((item) => item.id === candidate.questionId)
      ).toBe(false)
    }
  )

  it('retires a seed current while preserving its open candidate and retained learner lineage', async () => {
    const state = createState()
    const candidate = await createCandidateForSeed(
      state,
      'DRAFT',
      'retirement keeps candidate'
    )
    const before = state.snapshot(sources)
    const question = getQuestion(before, candidate.questionId)
    const currentId = question.currentPublishedVersionId
    if (!currentId) throw new Error('Seed current version is unavailable.')
    const current = before.versions.find(
      (version) => version.questionVersionId === currentId
    )
    if (!current) throw new Error('Seed current version state is unavailable.')
    const pins: MockPhase7LearnerPins = {
      bookmarkedQuestionIds: [question.questionId],
      studyResultQuestionVersionIds: [currentId],
      studySessionQuestionVersionIds: [currentId],
      wrongNotes: [
        {
          currentReviewQuestionVersionId: currentId,
          lastWrongQuestionVersionId: currentId,
          questionId: question.questionId
        }
      ]
    }
    const learnerBefore = state.getLearnerProjection(sources, pins)

    await expect(
      state.retireQuestionVersion({
        actorId: DEMO_REVIEWER_ADMIN_ID,
        assertAuthority: () => undefined,
        request: {
          expectedQuestionRowVersion: question.rowVersion + 1,
          expectedRowVersion: current.rowVersion
        },
        requestId: crypto.randomUUID(),
        sources,
        versionId: currentId
      })
    ).rejects.toMatchObject({ code: 'VERSION_CONFLICT' })
    expect(state.snapshot(sources)).toEqual(before)

    const result = await state.retireQuestionVersion({
      actorId: DEMO_REVIEWER_ADMIN_ID,
      assertAuthority: () => undefined,
      request: {
        expectedQuestionRowVersion: question.rowVersion,
        expectedRowVersion: current.rowVersion
      },
      requestId: crypto.randomUUID(),
      sources,
      versionId: currentId
    })
    const withoutSource = state.snapshot([])
    const withStaleSource = state.snapshot(sources)
    expect(withStaleSource).toEqual(withoutSource)
    expect(getQuestion(withStaleSource, question.questionId)).toMatchObject({
      lifecycleStatus: 'ACTIVE',
      currentPublishedVersionId: null,
      openCandidateVersionId: candidate.versionId,
      rowVersion: question.rowVersion + 1
    })
    expect(
      withStaleSource.versions.find(
        (version) => version.questionVersionId === currentId
      )
    ).toMatchObject({
      versionStatus: 'RETIRED',
      retirementKind: 'PUBLISHED_RETIREMENT',
      retiredAt: result.occurredAt,
      rowVersion: current.rowVersion + 1
    })
    expect(
      withStaleSource.versions.find(
        (version) => version.questionVersionId === candidate.versionId
      )
    ).toMatchObject({
      versionStatus: 'DRAFT',
      rowVersion: candidate.versionRowVersion
    })
    const learnerAfter = state.getLearnerProjection(sources, pins)
    expect(learnerAfter.publicQuestions).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: question.questionId })
      ])
    )
    expect(learnerAfter.practiceCandidates).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: question.questionId })
      ])
    )
    expect(learnerAfter.studySessionQuestions).toEqual(
      learnerBefore.studySessionQuestions
    )
    expect(learnerAfter.studyResultQuestions).toEqual(
      learnerBefore.studyResultQuestions
    )
    expect(learnerAfter.wrongNotes[0]).toMatchObject({
      lastWrongQuestion: { question: { questionVersionId: currentId } },
      reviewAvailability: 'ARCHIVED',
      reviewCandidate: null
    })
    expect(learnerAfter.bookmarks[0]).toMatchObject({
      availability: 'ARCHIVED',
      summaryVersionId: currentId
    })
  })

  it('archives a current-only seed and preserves its retired lineage across stale sync', async () => {
    const state = createState()
    const before = state.snapshot(sources)
    const question = getQuestion(before)
    const versionId = question.currentPublishedVersionId
    if (!versionId) throw new Error('Seed current version is unavailable.')
    const beforeVersion = before.versions.find(
      (version) => version.questionVersionId === versionId
    )!
    await expect(
      state.archiveAdminQuestion({
        actorId: DEMO_REVIEWER_ADMIN_ID,
        assertAuthority: () => undefined,
        questionId: question.questionId,
        request: {
          expectedQuestionRowVersion: question.rowVersion + 1,
          expectedOpenCandidateVersionId: null,
          expectedOpenCandidateRowVersion: null
        },
        requestId: crypto.randomUUID(),
        sources
      })
    ).rejects.toMatchObject({ code: 'VERSION_CONFLICT' })
    expect(state.snapshot(sources)).toEqual(before)
    await expect(
      state.archiveAdminQuestion({
        actorId: DEMO_REVIEWER_ADMIN_ID,
        assertAuthority: () => undefined,
        questionId: question.questionId,
        request: {
          expectedQuestionRowVersion: question.rowVersion,
          expectedOpenCandidateVersionId: crypto.randomUUID(),
          expectedOpenCandidateRowVersion: 1
        },
        requestId: crypto.randomUUID(),
        sources
      })
    ).rejects.toMatchObject({ code: 'VERSION_CONFLICT' })
    expect(state.snapshot(sources)).toEqual(before)
    const requestId = crypto.randomUUID()
    const result = await state.archiveAdminQuestion({
      actorId: DEMO_REVIEWER_ADMIN_ID,
      assertAuthority: () => undefined,
      questionId: question.questionId,
      request: {
        expectedQuestionRowVersion: question.rowVersion,
        expectedOpenCandidateVersionId: null,
        expectedOpenCandidateRowVersion: null
      },
      requestId,
      sources
    })
    const withoutSource = state.snapshot([])
    const withStaleSource = state.snapshot(sources)
    expect(withStaleSource).toEqual(withoutSource)
    expect(getQuestion(withStaleSource, question.questionId)).toMatchObject({
      lifecycleStatus: 'ARCHIVED',
      currentPublishedVersionId: null,
      archivedAt: result.occurredAt,
      rowVersion: question.rowVersion + 1
    })
    expect(
      withStaleSource.versions.find(
        (version) => version.questionVersionId === versionId
      )
    ).toMatchObject({
      versionStatus: 'RETIRED',
      retirementKind: 'PUBLISHED_RETIREMENT',
      rowVersion: beforeVersion.rowVersion + 1
    })
    expect(
      withStaleSource.reviews.filter((review) => review.requestId === requestId)
    ).toEqual([
      expect.objectContaining({
        action: 'RETIRED',
        reason: 'QUESTION_ARCHIVE'
      })
    ])
  })

  it('rejects never-published and cross-Question learner pins without mutating state', async () => {
    const state = createState()
    const seedCandidate = await createCandidateForSeed(
      state,
      'DRAFT',
      'never published learner pin'
    )
    const beforeCandidatePin = state.snapshot(sources)
    expect(() =>
      state.getLearnerProjection(sources, {
        ...emptyPins,
        studySessionQuestionVersionIds: [seedCandidate.versionId]
      })
    ).toThrow(/does not reference published lineage/u)
    expect(state.snapshot(sources)).toEqual(beforeCandidatePin)

    const candidateOnly = await createCandidateOnly(
      state,
      'DRAFT',
      'cross question learner pin'
    )
    const seedQuestion = getQuestion(
      state.snapshot(sources),
      seedCandidate.questionId
    )
    const seedVersionId = seedQuestion.currentPublishedVersionId
    if (!seedVersionId)
      throw new Error('Seed published version is unavailable.')
    const beforeCrossQuestionPin = state.snapshot(sources)
    expect(() =>
      state.getLearnerProjection(sources, {
        ...emptyPins,
        wrongNotes: [
          {
            currentReviewQuestionVersionId: null,
            lastWrongQuestionVersionId: seedVersionId,
            questionId: candidateOnly.questionId
          }
        ]
      })
    ).toThrow(/belongs to another Question/u)
    expect(state.snapshot(sources)).toEqual(beforeCrossQuestionPin)

    await state.archiveAdminQuestion({
      actorId: DEMO_REVIEWER_ADMIN_ID,
      assertAuthority: () => undefined,
      questionId: candidateOnly.questionId,
      request: {
        expectedQuestionRowVersion: candidateOnly.questionRowVersion,
        expectedOpenCandidateVersionId: candidateOnly.versionId,
        expectedOpenCandidateRowVersion: candidateOnly.versionRowVersion
      },
      requestId: crypto.randomUUID(),
      sources
    })
    const afterAbandonment = state.snapshot(sources)
    expect(() =>
      state.getLearnerProjection(sources, {
        ...emptyPins,
        studyResultQuestionVersionIds: [candidateOnly.versionId]
      })
    ).toThrow(/does not reference published lineage/u)
    expect(state.snapshot(sources)).toEqual(afterAbandonment)
  })

  it('rejects invalid-state, SoD and visible-duplicate publication with write zero', async () => {
    const invalidState = createState()
    const draft = await createCandidateForSeed(
      invalidState,
      'DRAFT',
      'invalid publication state'
    )
    const invalidRequestId = crypto.randomUUID()
    const beforeInvalid = invalidState.snapshot(sources)
    await expect(
      invalidState.publishQuestionVersion({
        actorId: DEMO_ADMIN_ID,
        assertAuthority: () => undefined,
        request: {
          expectedQuestionRowVersion: draft.questionRowVersion,
          expectedRowVersion: draft.versionRowVersion
        },
        requestId: invalidRequestId,
        sources,
        versionId: draft.versionId
      })
    ).rejects.toMatchObject({
      code: 'INVALID_STATE_TRANSITION',
      disposition: 'NO_TX',
      message: '승인된 활성 문제 버전만 게시할 수 있습니다.'
    })
    expect(invalidState.snapshot(sources)).toEqual(beforeInvalid)
    expect(
      beforeInvalid.auditLogs.filter(
        ({ requestId }) => requestId === invalidRequestId
      )
    ).toEqual([])
    expect(
      beforeInvalid.reviews.filter(
        ({ requestId }) => requestId === invalidRequestId
      )
    ).toEqual([])

    const sodState = createState()
    const sodCandidate = await createCandidateForSeed(
      sodState,
      'APPROVED',
      'publication separation of duties'
    )
    const mutableReviews = Reflect.get(sodState, 'reviews') as Array<
      MockPhase7AdminCmsSnapshot['reviews'][number]
    >
    const approvalIndex = mutableReviews.findIndex(
      (review) =>
        review.questionVersionId === sodCandidate.versionId &&
        review.action === 'APPROVED'
    )
    const approval = mutableReviews[approvalIndex]
    if (!approval || approval.actor.kind !== 'ACCOUNT') {
      throw new Error('Publication approval evidence is unavailable.')
    }
    mutableReviews[approvalIndex] = {
      ...approval,
      actor: { ...approval.actor, actorId: DEMO_ADMIN_ID }
    }
    const sodRequestId = crypto.randomUUID()
    const beforeSod = sodState.snapshot(sources)
    await expect(
      sodState.publishQuestionVersion({
        actorId: DEMO_ADMIN_ID,
        assertAuthority: () => undefined,
        request: {
          expectedQuestionRowVersion: sodCandidate.questionRowVersion,
          expectedRowVersion: sodCandidate.versionRowVersion
        },
        requestId: sodRequestId,
        sources,
        versionId: sodCandidate.versionId
      })
    ).rejects.toMatchObject({
      code: 'SEPARATION_OF_DUTIES_VIOLATION',
      disposition: 'NO_TX',
      message: '작성자와 최신 승인자는 서로 달라야 합니다.'
    })
    expect(sodState.snapshot(sources)).toEqual(beforeSod)
    expect(
      beforeSod.auditLogs.filter(({ requestId }) => requestId === sodRequestId)
    ).toEqual([])
    expect(
      beforeSod.reviews.filter(({ requestId }) => requestId === sodRequestId)
    ).toEqual([])

    const duplicateState = createState()
    const duplicateSuffix = 'visible publication duplicate'
    const duplicateCandidate = await createCandidateForSeed(
      duplicateState,
      'APPROVED',
      duplicateSuffix
    )
    const duplicateSources = [
      ...sources,
      createDuplicateSource(duplicateSuffix)
    ]
    const duplicateRequestId = crypto.randomUUID()
    const beforeDuplicate = duplicateState.snapshot(duplicateSources)
    await expect(
      duplicateState.publishQuestionVersion({
        actorId: DEMO_ADMIN_ID,
        assertAuthority: () => undefined,
        request: {
          expectedQuestionRowVersion: duplicateCandidate.questionRowVersion,
          expectedRowVersion: duplicateCandidate.versionRowVersion
        },
        requestId: duplicateRequestId,
        sources: duplicateSources,
        versionId: duplicateCandidate.versionId
      })
    ).rejects.toMatchObject({
      code: 'DUPLICATE_QUESTION_CONTENT',
      disposition: 'NO_TX',
      message: '동일한 내용의 문제가 이미 존재합니다.'
    })
    expect(duplicateState.snapshot(duplicateSources)).toEqual(beforeDuplicate)
    expect(
      beforeDuplicate.auditLogs.filter(
        ({ requestId }) => requestId === duplicateRequestId
      )
    ).toEqual([])
    expect(
      beforeDuplicate.reviews.filter(
        ({ requestId }) => requestId === duplicateRequestId
      )
    ).toEqual([])
  })

  it('rejects retirement and archive invalid states with write zero', async () => {
    const retirementState = createState()
    const nonCurrent = await createCandidateForSeed(
      retirementState,
      'DRAFT',
      'invalid retirement target'
    )
    const retirementRequestId = crypto.randomUUID()
    const beforeRetirement = retirementState.snapshot(sources)
    await expect(
      retirementState.retireQuestionVersion({
        actorId: DEMO_REVIEWER_ADMIN_ID,
        assertAuthority: () => undefined,
        request: {
          expectedQuestionRowVersion: nonCurrent.questionRowVersion,
          expectedRowVersion: nonCurrent.versionRowVersion
        },
        requestId: retirementRequestId,
        sources,
        versionId: nonCurrent.versionId
      })
    ).rejects.toMatchObject({
      code: 'INVALID_STATE_TRANSITION',
      disposition: 'NO_TX',
      message: '현재 공개 중인 활성 문제 버전만 단독 폐기할 수 있습니다.'
    })
    expect(retirementState.snapshot(sources)).toEqual(beforeRetirement)
    expect(
      beforeRetirement.auditLogs.filter(
        ({ requestId }) => requestId === retirementRequestId
      )
    ).toEqual([])
    expect(
      beforeRetirement.reviews.filter(
        ({ requestId }) => requestId === retirementRequestId
      )
    ).toEqual([])

    const archiveState = createState()
    const active = getQuestion(archiveState.snapshot(sources))
    await archiveState.archiveAdminQuestion({
      actorId: DEMO_REVIEWER_ADMIN_ID,
      assertAuthority: () => undefined,
      questionId: active.questionId,
      request: {
        expectedQuestionRowVersion: active.rowVersion,
        expectedOpenCandidateVersionId: null,
        expectedOpenCandidateRowVersion: null
      },
      requestId: crypto.randomUUID(),
      sources
    })
    const beforeSecondArchive = archiveState.snapshot(sources)
    const archived = getQuestion(beforeSecondArchive, active.questionId)
    const archiveRequestId = crypto.randomUUID()
    await expect(
      archiveState.archiveAdminQuestion({
        actorId: DEMO_REVIEWER_ADMIN_ID,
        assertAuthority: () => undefined,
        questionId: active.questionId,
        request: {
          expectedQuestionRowVersion: archived.rowVersion,
          expectedOpenCandidateVersionId: null,
          expectedOpenCandidateRowVersion: null
        },
        requestId: archiveRequestId,
        sources
      })
    ).rejects.toMatchObject({
      code: 'INVALID_STATE_TRANSITION',
      disposition: 'NO_TX',
      message: '활성 문제만 현재 공개·후보 버전과 함께 보관할 수 있습니다.'
    })
    expect(archiveState.snapshot(sources)).toEqual(beforeSecondArchive)
    expect(
      beforeSecondArchive.auditLogs.filter(
        ({ requestId }) => requestId === archiveRequestId
      )
    ).toEqual([])
    expect(
      beforeSecondArchive.reviews.filter(
        ({ requestId }) => requestId === archiveRequestId
      )
    ).toEqual([])
  })

  it('rolls back an invisible publication duplicate discovered behind a winner', async () => {
    const state = createState()
    const winner = await createCandidateOnly(
      state,
      'APPROVED',
      'concurrent publication winner'
    )
    const loserSuffix = 'concurrent publication duplicate'
    const loser = await createCandidateOnly(state, 'APPROVED', loserSuffix)
    const mutableSources: MockCanonicalAdminQuestionSource[] = [...sources]
    const duplicateSource = createDuplicateSource(loserSuffix)
    const winnerRequestId = crypto.randomUUID()
    const loserRequestId = crypto.randomUUID()
    const before = state.snapshot(mutableSources)
    const winnerPromise = state.publishQuestionVersion({
      actorId: DEMO_ADMIN_ID,
      assertAuthority: () => {
        mutableSources.push(duplicateSource)
      },
      request: {
        expectedQuestionRowVersion: winner.questionRowVersion,
        expectedRowVersion: winner.versionRowVersion
      },
      requestId: winnerRequestId,
      sources: mutableSources,
      versionId: winner.versionId
    })
    const loserPromise = state.publishQuestionVersion({
      actorId: DEMO_ADMIN_ID,
      assertAuthority: () => undefined,
      request: {
        expectedQuestionRowVersion: loser.questionRowVersion,
        expectedRowVersion: loser.versionRowVersion
      },
      requestId: loserRequestId,
      sources: mutableSources,
      versionId: loser.versionId
    })
    const [winnerOutcome, loserOutcome] = await Promise.allSettled([
      winnerPromise,
      loserPromise
    ])
    expect(winnerOutcome.status).toBe('fulfilled')
    expect(loserOutcome).toMatchObject({
      status: 'rejected',
      reason: {
        code: 'SERVICE_UNAVAILABLE',
        disposition: 'DEFINITE_ROLLBACK',
        internalReason: 'CONTENT_DUPLICATE_CONCURRENT_RACE',
        message: '동시 콘텐츠 중복 여부를 안전하게 확정할 수 없습니다.'
      }
    })
    const after = state.snapshot(mutableSources)
    expect(getQuestion(after, winner.questionId)).toMatchObject({
      currentPublishedVersionId: winner.versionId,
      openCandidateVersionId: null,
      rowVersion: winner.questionRowVersion + 1
    })
    expect(getQuestion(after, loser.questionId)).toMatchObject({
      currentPublishedVersionId: null,
      openCandidateVersionId: loser.versionId,
      rowVersion: loser.questionRowVersion
    })
    expect(
      after.versions.find(
        ({ questionVersionId }) => questionVersionId === loser.versionId
      )
    ).toMatchObject({
      rowVersion: loser.versionRowVersion,
      versionStatus: 'APPROVED'
    })
    expect(
      after.auditLogs.filter(({ requestId }) => requestId === loserRequestId)
    ).toEqual([])
    expect(
      after.reviews.filter(({ requestId }) => requestId === loserRequestId)
    ).toEqual([])
    expect(
      before.auditLogs.filter(({ requestId }) => requestId === loserRequestId)
    ).toEqual([])
  })

  it('keeps every planned write at zero when the commit-time authority fence fails', async () => {
    const state = createState()
    const candidate = await createCandidateForSeed(
      state,
      'APPROVED',
      'late authority failure'
    )
    const before = state.snapshot(sources)
    const authority = vi.fn(() => {
      throw new MockPhase7AdminCommandError({
        code: 'FRESH_ASSURANCE_REQUIRED',
        message: 'fresh assurance expired',
        disposition: 'DEFINITE_ROLLBACK'
      })
    })
    await expect(
      state.publishQuestionVersion({
        actorId: DEMO_ADMIN_ID,
        assertAuthority: authority,
        request: {
          expectedQuestionRowVersion: candidate.questionRowVersion,
          expectedRowVersion: candidate.versionRowVersion
        },
        requestId: crypto.randomUUID(),
        sources,
        versionId: candidate.versionId
      })
    ).rejects.toMatchObject({
      code: 'FRESH_ASSURANCE_REQUIRED',
      disposition: 'DEFINITE_ROLLBACK'
    })
    expect(state.snapshot(sources)).toEqual(before)

    const seedQuestion = getQuestion(before, candidate.questionId)
    const seedVersionId = seedQuestion.currentPublishedVersionId
    if (!seedVersionId) throw new Error('Seed current version is unavailable.')
    const seedVersion = before.versions.find(
      (version) => version.questionVersionId === seedVersionId
    )
    if (!seedVersion) throw new Error('Seed current state is unavailable.')
    await expect(
      state.retireQuestionVersion({
        actorId: DEMO_REVIEWER_ADMIN_ID,
        assertAuthority: authority,
        request: {
          expectedQuestionRowVersion: seedQuestion.rowVersion,
          expectedRowVersion: seedVersion.rowVersion
        },
        requestId: crypto.randomUUID(),
        sources,
        versionId: seedVersionId
      })
    ).rejects.toMatchObject({
      code: 'FRESH_ASSURANCE_REQUIRED',
      disposition: 'DEFINITE_ROLLBACK'
    })
    expect(state.snapshot(sources)).toEqual(before)

    await expect(
      state.archiveAdminQuestion({
        actorId: DEMO_REVIEWER_ADMIN_ID,
        assertAuthority: authority,
        questionId: seedQuestion.questionId,
        request: {
          expectedQuestionRowVersion: seedQuestion.rowVersion,
          expectedOpenCandidateVersionId: candidate.versionId,
          expectedOpenCandidateRowVersion: candidate.versionRowVersion
        },
        requestId: crypto.randomUUID(),
        sources
      })
    ).rejects.toMatchObject({
      code: 'FRESH_ASSURANCE_REQUIRED',
      disposition: 'DEFINITE_ROLLBACK'
    })
    expect(authority).toHaveBeenCalledTimes(3)
    expect(state.snapshot(sources)).toEqual(before)
  })
})
