import { describe, expect, it } from 'vitest'
import { bookmarkSummarySchema } from '../src/bookmark/bookmark.js'
import { resumableStudySessionSummarySchema } from '../src/study/list-resumable-study-sessions.js'
import { studyDraftSnapshotSchema } from '../src/study/study-draft.js'
import { versionedStudySessionPayloadSchema } from '../src/study/study-session.js'
import {
  assertNoPreSubmitForbiddenKeys,
  assertSessionPracticeContractHeaderMatchesBody,
  assertStudyDraftFullCoverage,
  findPreSubmitForbiddenKeyPaths,
  practiceFlowConformanceFixture,
  practiceRouteConformanceCases
} from '../src/testing/practice-flow-conformance.js'
import { studySubmitVersionConformanceFixture } from '../src/testing/study-submit-version-conformance.js'

describe('Phase 4 shared conformance fixtures', () => {
  it('session·draft·resumable·Bookmark clean fixture의 answer/owner leak가 0이다', () => {
    for (const value of [
      practiceFlowConformanceFixture.session,
      practiceFlowConformanceFixture.draft,
      practiceFlowConformanceFixture.resumable,
      practiceFlowConformanceFixture.bookmark
    ]) {
      expect(findPreSubmitForbiddenKeyPaths(value)).toEqual([])
      expect(() => assertNoPreSubmitForbiddenKeys(value)).not.toThrow()
    }

    expect(
      versionedStudySessionPayloadSchema.parse(
        practiceFlowConformanceFixture.session
      )
    ).toEqual(practiceFlowConformanceFixture.session)
    expect(
      studyDraftSnapshotSchema.parse(practiceFlowConformanceFixture.draft)
    ).toEqual(practiceFlowConformanceFixture.draft)
    expect(
      resumableStudySessionSummarySchema.parse(
        practiceFlowConformanceFixture.resumable
      )
    ).toEqual(practiceFlowConformanceFixture.resumable)
    expect(
      bookmarkSummarySchema.parse(practiceFlowConformanceFixture.bookmark)
    ).toEqual(practiceFlowConformanceFixture.bookmark)

    expect(() =>
      assertSessionPracticeContractHeaderMatchesBody(
        practiceFlowConformanceFixture.session,
        '2'
      )
    ).not.toThrow()
    expect(() =>
      assertSessionPracticeContractHeaderMatchesBody(
        practiceFlowConformanceFixture.session,
        '1'
      )
    ).toThrow('response practice header')

    const { practiceContractVersion: _version, ...v1Session } =
      practiceFlowConformanceFixture.session.session
    const v1Payload = {
      ...practiceFlowConformanceFixture.session,
      session: v1Session
    }
    expect(() =>
      assertSessionPracticeContractHeaderMatchesBody(v1Payload, '1')
    ).not.toThrow()
    expect(() =>
      assertSessionPracticeContractHeaderMatchesBody(v1Payload, '2')
    ).toThrow('response practice header')
  })

  it('root·nested·array의 정답·해설·owner key를 재귀적으로 검출한다', () => {
    const leaked = {
      userId: 'owner',
      questions: [
        {
          question: {
            correctOptionId: 'option',
            options: [{ isCorrect: true }]
          }
        }
      ],
      metadata: {
        explanationKo: '해설',
        createdByUserId: 'admin',
        sourceType: 'ORIGINAL',
        rowVersion: 1
      }
    }

    expect(findPreSubmitForbiddenKeyPaths(leaked)).toEqual([
      '$.userId',
      '$.questions[0].question.correctOptionId',
      '$.questions[0].question.options[0].isCorrect',
      '$.metadata.explanationKo',
      '$.metadata.createdByUserId',
      '$.metadata.sourceType',
      '$.metadata.rowVersion'
    ])
    expect(() => assertNoPreSubmitForbiddenKeys(leaked)).toThrow(
      'Pre-submit payload'
    )
  })

  it('draft full coverage를 session ordinal ID exact 배열로 고정한다', () => {
    expect(() =>
      assertStudyDraftFullCoverage(
        practiceFlowConformanceFixture.draft,
        practiceFlowConformanceFixture.sessionQuestionIds
      )
    ).not.toThrow()
    expect(() =>
      assertStudyDraftFullCoverage(practiceFlowConformanceFixture.draft, [
        '018f6b7a-1f4b-7d5e-8a91-ffffffffffff'
      ])
    ).toThrow('full snapshot')
  })

  it('8개 route의 status·JSON/204·response header 소유권을 fixture로 고정한다', () => {
    expect(practiceRouteConformanceCases).toHaveLength(8)
    expect(
      practiceRouteConformanceCases.map((item) => item.operationId)
    ).toEqual([
      'study.listResumableStudySessions',
      'study.getStudyDraftAnswers',
      'study.saveStudyDraftAnswers',
      'study.cancelStudySession',
      'study.createResultRetrySession',
      'bookmark.listBookmarks',
      'bookmark.createBookmark',
      'bookmark.deleteBookmark'
    ])

    const noBodyCases = practiceRouteConformanceCases.filter(
      (item) => item.responseBody === 'NONE'
    )
    expect(noBodyCases.map((item) => item.successStatuses)).toEqual([
      [204],
      [204]
    ])
    for (const item of noBodyCases) {
      expect(item.forbiddenResponseHeaders).toContain('Content-Type')
      expect(
        item.requiredResponseHeaders.map((header) => header.name)
      ).not.toContain('Content-Type')
    }

    for (const index of [2, 4]) {
      expect(
        practiceRouteConformanceCases[index]?.conditionalResponseHeaders
      ).toEqual([
        {
          name: 'Idempotency-Replayed',
          expectedValue: 'true',
          match: 'EXACT',
          when: 'IDEMPOTENCY_REPLAY'
        }
      ])
    }
    expect(
      practiceRouteConformanceCases[0]?.requiredResponseHeaders
    ).toContainEqual({
      name: 'Cache-Control',
      expectedValue: 'private, no-store',
      match: 'EXACT'
    })
    expect(
      practiceRouteConformanceCases[0]?.requiredResponseHeaders
    ).toContainEqual({
      name: 'X-Nihongo-Practice-Contract',
      expectedValue: '2',
      match: 'EXACT'
    })
    expect(
      practiceRouteConformanceCases[4]?.requiredResponseHeaders
    ).toContainEqual({
      name: 'Location',
      expectedValue: '/api/v1/study-sessions/:targetSessionId',
      match: 'PATH_TEMPLATE'
    })
  })

  it('submit-v1/v2 material property order와 SHA-256을 별도로 동결한다', async () => {
    const fixture = studySubmitVersionConformanceFixture
    const answers = fixture.answers.map((answer) => ({ ...answer }))
    const v1 = `submit-v1:${JSON.stringify({
      sessionId: fixture.sessionId,
      answers,
      durationSec: fixture.durationSec
    })}`
    const v2 = `submit-v2:${JSON.stringify({
      sessionId: fixture.sessionId,
      answers,
      durationSec: fixture.durationSec,
      expectedDraftRevision: fixture.expectedDraftRevision
    })}`

    expect(v1).toBe(fixture.v1CanonicalMaterial)
    expect(v2).toBe(fixture.v2CanonicalMaterial)
    const getSha256 = async (value: string): Promise<string> => {
      const crypto = (
        globalThis as typeof globalThis & {
          crypto?: {
            subtle: {
              digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer>
            }
          }
        }
      ).crypto

      if (!crypto) {
        throw new Error('SHA-256 conformance에 Web Crypto가 필요합니다.')
      }

      const bytes = Uint8Array.from(value, (character) =>
        character.charCodeAt(0)
      )
      const digest = await crypto.subtle.digest('SHA-256', bytes)

      return [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('')
    }

    expect(await getSha256(v1)).toBe(fixture.v1Sha256)
    expect(await getSha256(v2)).toBe(fixture.v2Sha256)
    expect(fixture.v1Sha256).not.toBe(fixture.v2Sha256)
  })
})
