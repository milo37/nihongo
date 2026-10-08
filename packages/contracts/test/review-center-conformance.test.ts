import { describe, expect, it } from 'vitest'
import { createStudySessionV2BodySchema } from '../src/study/create-study-session.js'
import {
  createTargetedReviewSessionLocationSchema,
  createTargetedReviewSessionResponseForQuestionSchema
} from '../src/wrong-note/create-targeted-review-session.js'
import { createGetWrongNoteMemoResponseSchema } from '../src/wrong-note/get-wrong-note-memo.js'
import { listReviewEventsResponseSchema } from '../src/wrong-note/list-review-events.js'
import { listReviewQueueResponseSchema } from '../src/wrong-note/list-review-queue.js'
import {
  assertNoReviewCenterForbiddenKeys,
  findReviewCenterForbiddenKeyPaths,
  reviewCenterConformanceFixture,
  reviewCenterRouteConformanceCases
} from '../src/testing/review-center-conformance.js'

describe('Phase 5 review center conformance', () => {
  it('6개 operation의 method·path·status·header 소유권을 고정한다', () => {
    expect(reviewCenterRouteConformanceCases).toHaveLength(6)
    expect(
      reviewCenterRouteConformanceCases.map((item) => ({
        operationId: item.operationId,
        method: item.method,
        path: item.path,
        successStatuses: item.successStatuses
      }))
    ).toEqual([
      {
        operationId: 'wrongNote.listReviewQueue',
        method: 'GET',
        path: '/api/v1/review-queue',
        successStatuses: [200]
      },
      {
        operationId: 'wrongNote.getWrongNoteMemo',
        method: 'GET',
        path: '/api/v1/wrong-notes/:questionId/memo',
        successStatuses: [200]
      },
      {
        operationId: 'wrongNote.updateWrongNoteMemo',
        method: 'PUT',
        path: '/api/v1/wrong-notes/:questionId/memo',
        successStatuses: [200]
      },
      {
        operationId: 'wrongNote.listReviewEvents',
        method: 'GET',
        path: '/api/v1/wrong-notes/:questionId/review-events',
        successStatuses: [200]
      },
      {
        operationId: 'wrongNote.createTargetedReviewSession',
        method: 'POST',
        path: '/api/v1/wrong-notes/:questionId/review-session',
        successStatuses: [201]
      },
      {
        operationId: 'study.createStudySession',
        method: 'POST',
        path: '/api/v1/study-sessions',
        successStatuses: [201]
      }
    ])

    for (const route of reviewCenterRouteConformanceCases) {
      expect(route.responseBody).toBe('JSON')
      expect(route.requiredResponseHeaders).toContainEqual({
        name: 'Cache-Control',
        expectedValue: 'private, no-store',
        match: 'EXACT'
      })
      expect(route.requiredResponseHeaders).toContainEqual({
        name: 'X-Request-ID',
        expectedValue: 'opaque UUID',
        match: 'OPAQUE_ID'
      })
    }

    const targeted = reviewCenterRouteConformanceCases[4]
    expect(targeted?.requiredResponseHeaders).toContainEqual({
      name: 'X-Nihongo-Practice-Contract',
      expectedValue: '2',
      match: 'EXACT'
    })
    expect(targeted?.requiredResponseHeaders).toContainEqual({
      name: 'Location',
      expectedValue: '/api/v1/study-sessions/:targetSessionId',
      match: 'PATH_TEMPLATE'
    })
    expect(targeted?.conditionalResponseHeaders).toEqual([
      {
        name: 'Idempotency-Replayed',
        expectedValue: 'true',
        match: 'EXACT',
        when: 'IDEMPOTENCY_REPLAY'
      }
    ])
  })

  it('operation fixture가 shared schema를 통과하고 금지 key가 0이다', () => {
    const fixture = reviewCenterConformanceFixture
    expect(listReviewQueueResponseSchema.parse(fixture.queue)).toEqual(
      fixture.queue
    )
    expect(
      createGetWrongNoteMemoResponseSchema(fixture.memo.questionId).parse(
        fixture.memo
      )
    ).toEqual(fixture.memo)
    expect(listReviewEventsResponseSchema.parse(fixture.history)).toEqual(
      fixture.history
    )
    expect(
      createTargetedReviewSessionResponseForQuestionSchema(
        fixture.targetedQuestionId
      ).parse(fixture.targetedSession)
    ).toEqual(fixture.targetedSession)
    expect(
      createTargetedReviewSessionLocationSchema(
        fixture.targetedSession.session.id
      ).parse(fixture.targetedLocation)
    ).toBe(fixture.targetedLocation)
    expect(
      createStudySessionV2BodySchema.parse(fixture.filteredCreateBody)
    ).toEqual(fixture.filteredCreateBody)

    const targetedQuestion = fixture.targetedSession.questions[0]?.question
    const queueItem = fixture.queue.items[0]
    const latestEvent = fixture.history.items[0]
    const firstEvent = fixture.history.items.at(-1)
    if (
      targetedQuestion === undefined ||
      queueItem === undefined ||
      latestEvent === undefined ||
      firstEvent === undefined
    ) {
      throw new Error('Review center conformance fixture가 비어 있습니다.')
    }
    expect(queueItem.questionId).toBe(targetedQuestion.id)
    expect(queueItem.currentQuestionVersionId).toBe(
      targetedQuestion.questionVersionId
    )
    expect(queueItem.tags).toEqual(
      targetedQuestion.tags.map(({ label }) => label)
    )
    expect(
      targetedQuestion.options.some(
        ({ id }) => id === latestEvent.selectedOptionId
      )
    ).toBe(true)
    expect(latestEvent.isCorrect).toBe(false)
    expect(queueItem.status).toBe(latestEvent.nextStatus)
    expect(queueItem.correctStreak).toBe(latestEvent.nextCorrectStreak)
    expect(queueItem.wrongCount).toBe(latestEvent.wrongCountAfter)
    expect(queueItem.lastWrongAt).toBe(latestEvent.occurredAt)
    expect(queueItem.lastReviewedAt).toBe(latestEvent.occurredAt)
    expect(queueItem.nextReviewAt <= fixture.queue.observedAt).toBe(true)
    expect(fixture.queue.counts.due).toBe(fixture.queue.total)
    expect(fixture.queue.availableTags).toEqual(queueItem.tags)
    expect(
      firstEvent.occurredAt <= fixture.targetedSession.session.startedAt
    ).toBe(true)
    expect(
      fixture.queue.observedAt <= fixture.targetedSession.session.startedAt
    ).toBe(true)
    expect(
      fixture.targetedSession.session.startedAt <
        fixture.targetedSession.session.expiresAt
    ).toBe(true)

    for (const [kind, value] of [
      ['QUEUE', fixture.queue],
      ['MEMO', fixture.memo],
      ['HISTORY', fixture.history],
      ['TARGETED_SESSION', fixture.targetedSession]
    ] as const) {
      expect(findReviewCenterForbiddenKeyPaths(kind, value)).toEqual([])
      expect(() => assertNoReviewCenterForbiddenKeys(kind, value)).not.toThrow()
    }
  })

  it('operation별 허용 field는 보존하고 private/answer/admin leak를 재귀 검출한다', () => {
    expect(
      findReviewCenterForbiddenKeyPaths('MEMO', {
        text: '허용된 memo text',
        metadata: { ownerId: 'private' }
      })
    ).toEqual(['$.metadata.ownerId'])

    expect(
      findReviewCenterForbiddenKeyPaths('HISTORY', {
        items: [{ selectedOptionId: 'allowed', isCorrect: false }],
        memo: 'private'
      })
    ).toEqual(['$.memo'])

    const leakedQueue = {
      ...reviewCenterConformanceFixture.queue,
      items: [
        {
          ...reviewCenterConformanceFixture.queue.items[0],
          correctOptionId: 'answer',
          explanationKo: '해설',
          userId: 'owner',
          private: {
            requestHash: 'hash',
            sessionToken: 'token',
            auditMetadata: { reviewedByUserId: 'admin' }
          }
        }
      ]
    }
    expect(findReviewCenterForbiddenKeyPaths('QUEUE', leakedQueue)).toEqual([
      '$.items[0].correctOptionId',
      '$.items[0].explanationKo',
      '$.items[0].userId',
      '$.items[0].private.requestHash',
      '$.items[0].private.sessionToken',
      '$.items[0].private.auditMetadata',
      '$.items[0].private.auditMetadata.reviewedByUserId'
    ])
    expect(() =>
      assertNoReviewCenterForbiddenKeys('QUEUE', leakedQueue)
    ).toThrow('QUEUE payload')

    expect(
      findReviewCenterForbiddenKeyPaths('QUEUE', {
        schedule: { id: 'private' },
        events: [{ id: 'private' }],
        question: { questionText: 'full private question' }
      })
    ).toEqual(['$.schedule', '$.events', '$.question'])

    const rawRelationLeak = {
      wrongNote: { id: 'private' },
      nested: [
        {
          owner: { id: 'private' },
          studyAnswer: { id: 'private' },
          studySession: { id: 'private' },
          answer: { isCorrect: false },
          lastWrongQuestionVersion: { id: 'private' },
          currentReviewQuestionVersion: { id: 'private' }
        },
        {
          questionVersion: { explanation: 'private' },
          question: { questionText: 'private' },
          selectedOption: { id: 'private' },
          user: { id: 'private' },
          guestPrincipal: { id: 'private' },
          idempotencyRecord: { id: 'private' },
          reviewSchedule: { id: 'private' },
          actor: { id: 'private' },
          audit: { id: 'private' },
          admin: { id: 'private' }
        }
      ]
    }
    expect(
      findReviewCenterForbiddenKeyPaths('HISTORY', rawRelationLeak)
    ).toEqual([
      '$.wrongNote',
      '$.nested[0].owner',
      '$.nested[0].studyAnswer',
      '$.nested[0].studySession',
      '$.nested[0].answer',
      '$.nested[0].lastWrongQuestionVersion',
      '$.nested[0].currentReviewQuestionVersion',
      '$.nested[1].questionVersion',
      '$.nested[1].questionVersion.explanation',
      '$.nested[1].question',
      '$.nested[1].selectedOption',
      '$.nested[1].user',
      '$.nested[1].guestPrincipal',
      '$.nested[1].idempotencyRecord',
      '$.nested[1].reviewSchedule',
      '$.nested[1].actor',
      '$.nested[1].audit',
      '$.nested[1].admin'
    ])
  })
})
