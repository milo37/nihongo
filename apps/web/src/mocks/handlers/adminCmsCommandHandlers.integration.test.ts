import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  adminQuestionMutationResultSchema,
  getAdminQuestionResponseSchema,
  listAdminAuditLogResponseSchema,
  listAdminQuestionsResponseSchema,
  listQuestionVersionReviewsResponseSchema,
  phase7DormantAfterSlice3RA2OperationManifest,
  previewQuestionVersionResponseSchema,
  reauthenticateAdminErrorSchema,
  reauthenticateAdminResponseSchema,
  type CreateAdminQuestionRequest,
  type PreviewQuestionVersionResponse,
  type UpdateQuestionVersionRequest
} from '@nihongo/contracts/admin/phase7'
import { apiFailureSchema } from '@nihongo/contracts/common/error'
import { describe, expect, it, vi } from 'vitest'
import { DEMO_ADMIN_ID, DEMO_REVIEWER_ADMIN_ID } from '@mocks/data/users'
import { MOCK_ADMIN_PASSWORD } from '@mocks/handlers/authHandlers'
import {
  readPhase7MockJsonBody,
  resetAdminCmsCommandRateLimitForTesting
} from '@mocks/handlers/adminCmsCommandHandlers'
import { mockDatabase } from '@mocks/repository/mockDatabase'
import type { MockPhase7AdminCmsState } from '@mocks/repository/phase7AdminCmsState'

const BASE = 'http://localhost/api/v1/admin'
const canonicalMissingId = '019d0000-0000-7000-8000-000000000099'
const encoder = new TextEncoder()

const materializeManifestPath = (path: string): string =>
  path
    .replace(':questionId', canonicalMissingId)
    .replace(':versionId', canonicalMissingId)
    .replace(':reportId', canonicalMissingId)

const requireVersionId = (versionId: string | null): string => {
  if (versionId === null) {
    throw new Error('Admin command result is missing questionVersionId.')
  }

  return versionId
}

const jsonCommand = async (
  method: 'PATCH' | 'POST',
  pathname: string,
  body: unknown,
  additionalHeaders?: HeadersInit
): Promise<Response> => {
  const headers = new Headers(additionalHeaders)
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  if (!headers.has('Origin')) headers.set('Origin', 'http://localhost')
  return await fetch(`${BASE}${pathname}`, {
    method,
    headers,
    body: JSON.stringify(body)
  })
}

const loadSeedFixture = async (
  suffix: string
): Promise<{
  content: CreateAdminQuestionRequest
  preview: PreviewQuestionVersionResponse
  questionId: string
  versionId: string
}> => {
  const listResponse = await fetch(`${BASE}/questions?pageSize=1`)
  const list = listAdminQuestionsResponseSchema.parse(await listResponse.json())
  const seed = list.items[0]
  if (!seed) throw new Error('Phase 7 seed question is unavailable.')
  const previewResponse = await fetch(
    `${BASE}/question-versions/${seed.selectedVersionId}/preview`
  )
  const preview = previewQuestionVersionResponseSchema.parse(
    await previewResponse.json()
  )
  const correctIndex = preview.question.options.findIndex(
    (option) => option.id === preview.adminAnswer.correctOptionId
  )
  if (correctIndex < 0) {
    throw new Error('Phase 7 seed correct option is unavailable.')
  }
  return {
    questionId: seed.questionId,
    versionId: seed.selectedVersionId,
    preview,
    content: {
      level: preview.question.level,
      subject: preview.question.subject,
      questionType: preview.question.questionType,
      difficulty: preview.question.difficulty,
      questionText: `${preview.question.questionText}\n${suffix}`,
      passage: preview.question.passage,
      explanationKo: preview.adminAnswer.explanationKo,
      explanationJa: preview.adminAnswer.explanationJa,
      tagNames: preview.question.tags.map((tag) => tag.label),
      options: preview.question.options.map((option, index) => ({
        clientOptionKey: `option-${index + 1}`,
        text: option.text
      })),
      correctOptionKey: `option-${correctIndex + 1}`
    }
  }
}

const updateFromPreview = (
  preview: PreviewQuestionVersionResponse,
  expectedRowVersion: number,
  suffix: string
): UpdateQuestionVersionRequest => ({
  level: preview.question.level,
  subject: preview.question.subject,
  questionType: preview.question.questionType,
  difficulty: preview.question.difficulty,
  questionText: `${preview.question.questionText}\n${suffix}`,
  passage: preview.question.passage,
  explanationKo: preview.adminAnswer.explanationKo,
  explanationJa: preview.adminAnswer.explanationJa,
  tagNames: preview.question.tags.map((tag) => tag.label),
  options: preview.question.options.map((option, index) => ({
    id: option.id,
    ordinal: index + 1,
    text: option.text
  })),
  correctOptionId: preview.adminAnswer.correctOptionId,
  expectedRowVersion
})

const readPreview = async (
  versionId: string
): Promise<PreviewQuestionVersionResponse> => {
  const response = await fetch(`${BASE}/question-versions/${versionId}/preview`)
  expect(response.status).toBe(200)
  return previewQuestionVersionResponseSchema.parse(await response.json())
}

const readSuccessfulJson = async (response: Response): Promise<unknown> => {
  const body: unknown = await response.json()
  if (!response.ok) {
    throw new Error(
      `Expected successful response, received ${response.status}: ${JSON.stringify(body)}`
    )
  }

  return body
}

describe('Phase 7 canonical admin command MSW parity', () => {
  it('keeps prepared lifecycle symbols and paths out of the active MSW registry', () => {
    const activeSources = [
      readFileSync(
        resolve(process.cwd(), 'src/mocks/handlers/adminCmsCommandHandlers.ts'),
        'utf8'
      ),
      readFileSync(resolve(process.cwd(), 'src/mocks/handlers.ts'), 'utf8')
    ].join('\n')

    expect(activeSources).not.toMatch(
      /publishQuestionVersion|retireQuestionVersion|archiveAdminQuestion|\/publication|\/retirement|\/archive/u
    )
  })

  it('actual body cap은 cancel completion을 기다리지 않고 413으로 닫는다', async () => {
    let resolveCancellation: (() => void) | undefined
    const cancellation = new Promise<void>((resolve) => {
      resolveCancellation = resolve
    })
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('too-large'))
      },
      cancel() {
        return cancellation
      }
    })
    const request = new Request(`${BASE}/questions`, {
      body: stream,
      duplex: 'half',
      method: 'POST'
    } as RequestInit & { duplex: 'half' })

    await expect(readPhase7MockJsonBody(request, 1)).rejects.toMatchObject({
      code: 'REQUEST_TOO_LARGE'
    })
    resolveCancellation?.()
  })

  it.each(['null', 'true', '1', '"text"', '[]'])(
    'non-object JSON root %s를 INVALID_JSON으로 닫는다',
    async (raw) => {
      mockDatabase.loginAs('ADMIN', DEMO_ADMIN_ID)
      const response = await fetch(`${BASE}/questions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost'
        },
        body: raw
      })

      expect(response.status).toBe(400)
      expect(apiFailureSchema.parse(await response.json()).code).toBe(
        'INVALID_JSON'
      )
    }
  )

  it('preserves 65 seeds and exposes create/create-version through all reads', async () => {
    mockDatabase.loginAs('ADMIN', DEMO_ADMIN_ID)
    const seed = await loadSeedFixture('MSW 생성 읽기 정합성')

    const createResponse = await jsonCommand('POST', '/questions', seed.content)
    expect(createResponse.status).toBe(201)
    const created = adminQuestionMutationResultSchema.parse(
      await createResponse.json()
    )
    const createdVersionId = requireVersionId(created.questionVersionId)
    expect(created).toMatchObject({
      lifecycleStatus: 'ACTIVE',
      versionStatus: 'DRAFT',
      questionRowVersion: 1,
      versionRowVersion: 1
    })

    const list = listAdminQuestionsResponseSchema.parse(
      await readSuccessfulJson(await fetch(`${BASE}/questions?pageSize=100`))
    )
    expect(list.total).toBe(66)
    const summary = list.items.find(
      (item) => item.questionId === created.questionId
    )
    expect(summary).toMatchObject({
      selectedVersionId: createdVersionId,
      openCandidateVersionId: createdVersionId,
      versionStatus: 'DRAFT',
      answerCount: 0,
      correctRateBasisPoints: null
    })

    const detail = getAdminQuestionResponseSchema.parse(
      await readSuccessfulJson(
        await fetch(`${BASE}/questions/${created.questionId}`)
      )
    )
    expect(detail.question.openCandidateVersionId).toBe(createdVersionId)
    expect(detail.versions.items).toHaveLength(1)
    expect((await readPreview(createdVersionId)).adminAnswer).toEqual(
      expect.objectContaining({
        correctOptionId: expect.any(String)
      })
    )

    const versionContent = {
      ...seed.content,
      questionText: `${seed.content.questionText}\n새 버전`
    }
    const createVersionResponse = await jsonCommand(
      'POST',
      `/questions/${seed.questionId}/versions`,
      { ...versionContent, expectedQuestionRowVersion: 1 }
    )
    expect(createVersionResponse.status).toBe(201)
    const newVersion = adminQuestionMutationResultSchema.parse(
      await createVersionResponse.json()
    )
    const newVersionId = requireVersionId(newVersion.questionVersionId)
    expect(newVersion).toMatchObject({
      questionId: seed.questionId,
      questionRowVersion: 2,
      versionRowVersion: 1,
      versionStatus: 'DRAFT'
    })
    const seedSummary = listAdminQuestionsResponseSchema
      .parse(await (await fetch(`${BASE}/questions?pageSize=100`)).json())
      .items.find((item) => item.questionId === seed.questionId)
    expect(seedSummary).toMatchObject({
      currentPublishedVersionId: seed.versionId,
      openCandidateVersionId: newVersionId,
      selectedVersionId: newVersionId,
      answerCount: 0,
      correctRateBasisPoints: null
    })

    const audit = listAdminAuditLogResponseSchema.parse(
      await (await fetch(`${BASE}/audit-log?limit=100`)).json()
    )
    expect(audit.items.map((item) => item.command).toSorted()).toEqual([
      'QUESTION_CREATE',
      'QUESTION_VERSION_CREATE'
    ])
  })

  it('enforces fresh reauthentication, SoD, evidence and concurrency across the A2 review lifecycle', async () => {
    mockDatabase.loginAs('ADMIN', DEMO_ADMIN_ID)
    const seed = await loadSeedFixture('MSW 전체 검수 흐름')
    const created = adminQuestionMutationResultSchema.parse(
      await (await jsonCommand('POST', '/questions', seed.content)).json()
    )
    const versionId = requireVersionId(created.questionVersionId)
    const initialPreview = await readPreview(versionId)
    const optionIds = initialPreview.question.options.map((option) => option.id)

    const updated = adminQuestionMutationResultSchema.parse(
      await (
        await jsonCommand(
          'PATCH',
          `/question-versions/${versionId}`,
          updateFromPreview(initialPreview, 1, '작성자 수정')
        )
      ).json()
    )
    expect(updated.versionRowVersion).toBe(2)

    const requested = adminQuestionMutationResultSchema.parse(
      await (
        await jsonCommand(
          'POST',
          `/question-versions/${versionId}/review-request`,
          { expectedRowVersion: 2, comment: '검수를 요청합니다.' }
        )
      ).json()
    )
    expect(requested).toMatchObject({
      versionStatus: 'IN_REVIEW',
      versionRowVersion: 3
    })

    const selfDecision = await jsonCommand(
      'POST',
      `/question-versions/${versionId}/change-request`,
      { expectedRowVersion: 3, reason: 'SELF_REVIEW' }
    )
    expect(selfDecision.status).toBe(409)
    expect(apiFailureSchema.parse(await selfDecision.json()).code).toBe(
      'SEPARATION_OF_DUTIES_VIOLATION'
    )

    mockDatabase.loginAs('ADMIN', DEMO_REVIEWER_ADMIN_ID)
    const changed = adminQuestionMutationResultSchema.parse(
      await (
        await jsonCommand(
          'POST',
          `/question-versions/${versionId}/change-request`,
          {
            expectedRowVersion: 3,
            reason: 'EXPLANATION_CLARITY',
            comment: '해설을 더 명확히 해주세요.'
          }
        )
      ).json()
    )
    expect(changed).toMatchObject({
      versionStatus: 'CHANGES_REQUESTED',
      versionRowVersion: 4
    })

    mockDatabase.loginAs('ADMIN', DEMO_ADMIN_ID)
    const changedPreview = await readPreview(versionId)
    const revised = adminQuestionMutationResultSchema.parse(
      await (
        await jsonCommand(
          'PATCH',
          `/question-versions/${versionId}`,
          updateFromPreview(changedPreview, 4, '검수 반영 수정')
        )
      ).json()
    )
    expect(revised.versionRowVersion).toBe(5)
    expect(
      (await readPreview(versionId)).question.options.map((option) => option.id)
    ).toEqual(optionIds)

    const rerequested = adminQuestionMutationResultSchema.parse(
      await (
        await jsonCommand(
          'POST',
          `/question-versions/${versionId}/review-request`,
          { expectedRowVersion: 5 }
        )
      ).json()
    )
    expect(rerequested.versionRowVersion).toBe(6)

    const beforeSelfApproval = mockDatabase.getCanonicalAdminCmsSnapshot()
    const selfApproval = await jsonCommand(
      'POST',
      `/question-versions/${versionId}/approval`,
      { expectedRowVersion: 6, comment: '작성자 본인 승인' }
    )
    expect(selfApproval.status).toBe(409)
    expect(apiFailureSchema.parse(await selfApproval.json()).code).toBe(
      'SEPARATION_OF_DUTIES_VIOLATION'
    )
    expect(mockDatabase.getCanonicalAdminCmsSnapshot()).toEqual(
      beforeSelfApproval
    )

    mockDatabase.loginAs('ADMIN', DEMO_REVIEWER_ADMIN_ID)
    const internalState = Reflect.get(
      mockDatabase,
      'phase7AdminCmsState'
    ) as Pick<MockPhase7AdminCmsState, 'startSession'>
    internalState.startSession(
      DEMO_REVIEWER_ADMIN_ID,
      '2020-01-01T00:00:00.000Z'
    )
    const beforeStaleApproval = mockDatabase.getCanonicalAdminCmsSnapshot()
    const staleApproval = await jsonCommand(
      'POST',
      `/question-versions/${versionId}/approval`,
      { expectedRowVersion: 6, comment: '승인합니다.' }
    )
    expect(staleApproval.status).toBe(401)
    expect(apiFailureSchema.parse(await staleApproval.json()).code).toBe(
      'FRESH_ASSURANCE_REQUIRED'
    )
    expect(mockDatabase.getCanonicalAdminCmsSnapshot()).toEqual(
      beforeStaleApproval
    )

    const reauthenticated = await jsonCommand('POST', '/reauthentication', {
      password: MOCK_ADMIN_PASSWORD
    })
    expect(reauthenticated.status).toBe(200)
    expect(reauthenticated.headers.getSetCookie()).toHaveLength(2)
    const afterReauthentication = mockDatabase.getCanonicalAdminCmsSnapshot()
    expect(afterReauthentication.questions).toEqual(
      beforeStaleApproval.questions
    )
    expect(afterReauthentication.versions).toEqual(beforeStaleApproval.versions)
    expect(afterReauthentication.reviews).toEqual(beforeStaleApproval.reviews)
    expect(afterReauthentication.auditLogs).toHaveLength(
      beforeStaleApproval.auditLogs.length + 1
    )
    expect(
      afterReauthentication.auditLogs
        .slice(beforeStaleApproval.auditLogs.length)
        .map(({ command }) => command)
    ).toEqual(['REAUTHENTICATION'])

    const approvalRequestId = crypto.randomUUID()
    const approval = await jsonCommand(
      'POST',
      `/question-versions/${versionId}/approval`,
      { expectedRowVersion: 6, comment: '승인합니다.' },
      { 'X-Request-Id': approvalRequestId }
    )
    expect(approval.status).toBe(200)
    expect(approval.headers.get('Set-Cookie')).toBeNull()
    expect(
      adminQuestionMutationResultSchema.parse(await approval.json())
    ).toMatchObject({
      questionRowVersion: 1,
      versionStatus: 'APPROVED',
      versionRowVersion: 7
    })

    mockDatabase.loginAs('ADMIN', DEMO_ADMIN_ID)
    const beforeSelfWithdrawal = mockDatabase.getCanonicalAdminCmsSnapshot()
    const selfWithdrawal = await jsonCommand(
      'POST',
      `/question-versions/${versionId}/approval-withdrawal`,
      { expectedRowVersion: 7, reason: 'SELF_WITHDRAWAL' }
    )
    expect(selfWithdrawal.status).toBe(409)
    expect(apiFailureSchema.parse(await selfWithdrawal.json()).code).toBe(
      'SEPARATION_OF_DUTIES_VIOLATION'
    )
    expect(mockDatabase.getCanonicalAdminCmsSnapshot()).toEqual(
      beforeSelfWithdrawal
    )

    mockDatabase.loginAs('ADMIN', DEMO_REVIEWER_ADMIN_ID)
    const beforeConcurrentWithdrawal =
      mockDatabase.getCanonicalAdminCmsSnapshot()
    const withdrawalRequestIds = [crypto.randomUUID(), crypto.randomUUID()]
    const withdrawals = await Promise.all(
      withdrawalRequestIds.map((withdrawalRequestId) =>
        jsonCommand(
          'POST',
          `/question-versions/${versionId}/approval-withdrawal`,
          {
            expectedRowVersion: 7,
            reason: 'FINAL_RECHECK',
            comment: '최종 근거를 다시 확인합니다.'
          },
          { 'X-Request-Id': withdrawalRequestId }
        )
      )
    )
    expect(withdrawals.map((response) => response.status).toSorted()).toEqual([
      200, 409
    ])
    const withdrawalWinner = withdrawals.find(
      (response) => response.status === 200
    )
    const withdrawalLoser = withdrawals.find(
      (response) => response.status === 409
    )
    if (!withdrawalWinner || !withdrawalLoser) {
      throw new Error('Concurrent withdrawal winner/loser is unavailable.')
    }
    const withdrawalWinnerIndex = withdrawals.indexOf(withdrawalWinner)
    const withdrawalLoserIndex = withdrawals.indexOf(withdrawalLoser)
    const withdrawalWinnerRequestId =
      withdrawalRequestIds[withdrawalWinnerIndex]
    const withdrawalLoserRequestId = withdrawalRequestIds[withdrawalLoserIndex]
    if (!withdrawalWinnerRequestId || !withdrawalLoserRequestId) {
      throw new Error('Concurrent withdrawal request IDs are unavailable.')
    }
    expect(
      adminQuestionMutationResultSchema.parse(await withdrawalWinner.json())
    ).toMatchObject({
      questionRowVersion: 1,
      versionStatus: 'CHANGES_REQUESTED',
      versionRowVersion: 8
    })
    expect(apiFailureSchema.parse(await withdrawalLoser.json()).code).toBe(
      'VERSION_CONFLICT'
    )
    expect(mockDatabase.getCanonicalAdminCmsSnapshot().reviews).toHaveLength(
      beforeConcurrentWithdrawal.reviews.length + 1
    )
    expect(mockDatabase.getCanonicalAdminCmsSnapshot().auditLogs).toHaveLength(
      beforeConcurrentWithdrawal.auditLogs.length + 1
    )

    const reviews = listQuestionVersionReviewsResponseSchema.parse(
      await (
        await fetch(`${BASE}/question-versions/${versionId}/reviews?limit=100`)
      ).json()
    )
    expect(reviews.items).toHaveLength(5)
    expect(reviews.items.map((item) => item.action).toSorted()).toEqual([
      'APPROVAL_WITHDRAWN',
      'APPROVED',
      'CHANGES_REQUESTED',
      'REQUESTED',
      'REQUESTED'
    ])
    expect(
      reviews.items
        .filter((item) => item.action !== 'REQUESTED')
        .every(
          (item) =>
            item.actor.kind === 'ACCOUNT' &&
            item.actor.actorId === DEMO_REVIEWER_ADMIN_ID &&
            item.counterpart?.kind === 'ACCOUNT' &&
            item.counterpart.actorId === DEMO_ADMIN_ID
        )
    ).toBe(true)
    expect(reviews.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'APPROVED',
          actor: expect.objectContaining({
            actorId: DEMO_REVIEWER_ADMIN_ID
          }),
          counterpart: expect.objectContaining({ actorId: DEMO_ADMIN_ID }),
          fromState: 'IN_REVIEW',
          toState: 'APPROVED',
          reason: null,
          comment: '승인합니다.'
        }),
        expect.objectContaining({
          action: 'APPROVAL_WITHDRAWN',
          actor: expect.objectContaining({
            actorId: DEMO_REVIEWER_ADMIN_ID
          }),
          counterpart: expect.objectContaining({ actorId: DEMO_ADMIN_ID }),
          fromState: 'APPROVED',
          toState: 'CHANGES_REQUESTED',
          reason: 'FINAL_RECHECK',
          comment: '최종 근거를 다시 확인합니다.'
        })
      ])
    )
    const approvalReview = reviews.items.find(
      ({ action }) => action === 'APPROVED'
    )
    const withdrawalReview = reviews.items.find(
      ({ action }) => action === 'APPROVAL_WITHDRAWN'
    )
    expect(approvalReview?.requestId).toBe(approvalRequestId)
    expect(withdrawalReview?.requestId).toBe(withdrawalWinnerRequestId)
    expect(
      reviews.items.some(
        ({ requestId: reviewRequestId }) =>
          reviewRequestId === withdrawalLoserRequestId
      )
    ).toBe(false)

    const detail = getAdminQuestionResponseSchema.parse(
      await readSuccessfulJson(
        await fetch(`${BASE}/questions/${created.questionId}`)
      )
    )
    expect(detail.question.openCandidateVersionId).toBe(versionId)
    expect(detail.versions.items[0]).toMatchObject({
      versionStatus: 'CHANGES_REQUESTED',
      rowVersion: 8,
      latestReviewer: {
        kind: 'ACCOUNT',
        actorId: DEMO_REVIEWER_ADMIN_ID
      }
    })
    const audit = listAdminAuditLogResponseSchema.parse(
      await (await fetch(`${BASE}/audit-log?limit=100`)).json()
    )
    expect(audit.items).toHaveLength(9)
    expect(audit.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: 'APPROVAL',
          beforeState: 'IN_REVIEW',
          afterState: 'APPROVED',
          beforeRowVersion: 6,
          afterRowVersion: 7,
          changedFields: ['VERSION_STATUS'],
          contentDigest: expect.stringMatching(/^[0-9a-f]{64}$/u)
        }),
        expect.objectContaining({
          command: 'APPROVAL_WITHDRAWAL',
          beforeState: 'APPROVED',
          afterState: 'CHANGES_REQUESTED',
          beforeRowVersion: 7,
          afterRowVersion: 8,
          changedFields: ['VERSION_STATUS'],
          contentDigest: expect.stringMatching(/^[0-9a-f]{64}$/u)
        })
      ])
    )
    const approvalAudit = audit.items.find(
      ({ command }) => command === 'APPROVAL'
    )
    const withdrawalAudit = audit.items.find(
      ({ command }) => command === 'APPROVAL_WITHDRAWAL'
    )
    expect(approvalAudit).toMatchObject({
      requestId: approvalRequestId,
      metadata: { kind: 'NONE_V1' }
    })
    expect(withdrawalAudit).toMatchObject({
      requestId: withdrawalWinnerRequestId,
      metadata: { kind: 'NONE_V1' }
    })
    expect(approvalReview?.operationId).toBe(approvalAudit?.operationId)
    expect(withdrawalReview?.operationId).toBe(withdrawalAudit?.operationId)
    expect(
      audit.items.some(
        ({ requestId: auditRequestId }) =>
          auditRequestId === withdrawalLoserRequestId
      )
    ).toBe(false)
  })

  it('returns one winner for concurrent duplicate and rowVersion races', async () => {
    mockDatabase.loginAs('ADMIN', DEMO_ADMIN_ID)
    const seed = await loadSeedFixture('MSW 동시 중복')
    const duplicateResponses = await Promise.all([
      jsonCommand('POST', '/questions', seed.content),
      jsonCommand('POST', '/questions', seed.content)
    ])
    expect(
      duplicateResponses.map((response) => response.status).toSorted()
    ).toEqual([201, 503])
    const winnerResponse = duplicateResponses.find(
      (response) => response.status === 201
    )
    const loserResponse = duplicateResponses.find(
      (response) => response.status === 503
    )
    if (!winnerResponse || !loserResponse) {
      throw new Error('Concurrent duplicate winner/loser is unavailable.')
    }
    const winner = adminQuestionMutationResultSchema.parse(
      await winnerResponse.json()
    )
    const winnerVersionId = requireVersionId(winner.questionVersionId)
    expect(apiFailureSchema.parse(await loserResponse.json())).toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      retryable: false
    })

    const visibleDuplicate = await jsonCommand(
      'POST',
      '/questions',
      seed.content
    )
    expect(visibleDuplicate.status).toBe(409)
    expect(apiFailureSchema.parse(await visibleDuplicate.json()).code).toBe(
      'DUPLICATE_QUESTION_CONTENT'
    )

    const preview = await readPreview(winnerVersionId)
    const competingUpdates = await Promise.all([
      jsonCommand(
        'PATCH',
        `/question-versions/${winnerVersionId}`,
        updateFromPreview(preview, 1, '동시 수정 A')
      ),
      jsonCommand(
        'PATCH',
        `/question-versions/${winnerVersionId}`,
        updateFromPreview(preview, 1, '동시 수정 B')
      )
    ])
    expect(
      competingUpdates.map((response) => response.status).toSorted()
    ).toEqual([200, 409])
    const conflict = competingUpdates.find(
      (response) => response.status === 409
    )
    if (!conflict)
      throw new Error('Concurrent rowVersion loser is unavailable.')
    expect(apiFailureSchema.parse(await conflict.json()).code).toBe(
      'VERSION_CONFLICT'
    )
    const snapshot = mockDatabase.getCanonicalAdminCmsSnapshot()
    expect(snapshot.questions).toHaveLength(66)
    expect(snapshot.auditLogs).toHaveLength(2)
    expect(snapshot.reviews).toHaveLength(0)
  })

  it('applies cap/auth/origin/JSON ordering and fresh precedence to A2 routes', async () => {
    const oversized = await fetch(`${BASE}/questions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': String(256 * 1024 + 1),
        Origin: 'http://localhost'
      },
      body: 'x'.repeat(256 * 1024 + 1)
    })
    expect(oversized.status).toBe(413)
    expect(apiFailureSchema.parse(await oversized.json()).code).toBe(
      'REQUEST_TOO_LARGE'
    )

    const guest = await jsonCommand('POST', '/questions', {})
    expect(guest.status).toBe(401)
    mockDatabase.loginAs('USER')
    const user = await jsonCommand('POST', '/questions', {})
    expect(user.status).toBe(403)

    mockDatabase.loginAs('ADMIN', DEMO_REVIEWER_ADMIN_ID)
    const internalState = Reflect.get(
      mockDatabase,
      'phase7AdminCmsState'
    ) as Pick<MockPhase7AdminCmsState, 'startSession'>
    internalState.startSession(
      DEMO_REVIEWER_ADMIN_ID,
      '2020-01-01T00:00:00.000Z'
    )
    const beforeReauthentication = mockDatabase.getCanonicalAdminCmsSnapshot()
    for (const [pathname, body] of [
      [
        `/question-versions/${canonicalMissingId}/approval`,
        { expectedRowVersion: 1 }
      ],
      [
        `/question-versions/${canonicalMissingId}/approval-withdrawal`,
        { expectedRowVersion: 1, reason: 'FINAL_RECHECK' }
      ]
    ] as const) {
      const stale = await jsonCommand('POST', pathname, body)
      expect(stale.status).toBe(401)
      expect(apiFailureSchema.parse(await stale.json()).code).toBe(
        'FRESH_ASSURANCE_REQUIRED'
      )
    }

    const wrongPassword = await jsonCommand('POST', '/reauthentication', {
      password: 'wrong-password-value'
    })
    expect(wrongPassword.status).toBe(401)
    expect(
      reauthenticateAdminErrorSchema.parse(await wrongPassword.json()).code
    ).toBe('REAUTHENTICATION_FAILED')
    expect(wrongPassword.headers.getSetCookie()).toHaveLength(0)
    expect(mockDatabase.getCanonicalAdminCmsSnapshot()).toEqual(
      beforeReauthentication
    )
    const reauthenticated = await jsonCommand('POST', '/reauthentication', {
      password: MOCK_ADMIN_PASSWORD
    })
    expect(reauthenticated.status).toBe(200)
    const reauthentication = reauthenticateAdminResponseSchema.parse(
      await reauthenticated.json()
    )
    expect(Date.parse(reauthentication.assuranceExpiresAt)).toBe(
      Date.parse(reauthentication.reauthenticatedAt) + 5 * 60_000
    )
    expect(reauthenticated.headers.getSetCookie()).toHaveLength(2)
    expect(reauthenticated.headers.getSetCookie()[0]).toContain(
      'nihongo.session_token='
    )
    expect(reauthenticated.headers.getSetCookie()[1]).toContain(
      'nihongo.dont_remember='
    )
    const afterReauthentication = mockDatabase.getCanonicalAdminCmsSnapshot()
    expect(afterReauthentication.auditLogs).toHaveLength(
      beforeReauthentication.auditLogs.length + 1
    )
    expect(afterReauthentication.auditLogs.at(-1)).toMatchObject({
      command: 'REAUTHENTICATION',
      beforeState: 'SESSION_STALE',
      afterState: 'SESSION_FRESH',
      metadata: {
        kind: 'REAUTHENTICATION_V1',
        rotation: 'OLD_REVOKED_NEW_ISSUED'
      }
    })
    expect(
      mockDatabase
        .getPhase7AdminCmsStateForHandlers()
        .hasFreshAssurance(DEMO_REVIEWER_ADMIN_ID)
    ).toBe(true)

    const afterFresh = await jsonCommand(
      'POST',
      `/question-versions/${canonicalMissingId}/approval`,
      { expectedRowVersion: 1 }
    )
    expect(afterFresh.status).toBe(404)

    const untrusted = await fetch(`${BASE}/questions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    })
    expect(untrusted.status).toBe(403)
    expect(apiFailureSchema.parse(await untrusted.json()).code).toBe(
      'UNTRUSTED_ORIGIN'
    )

    const duplicateJson = await fetch(`${BASE}/questions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost'
      },
      body: '{"password":"first-password","password":"second-password"}'
    })
    expect(duplicateJson.status).toBe(400)
    expect(apiFailureSchema.parse(await duplicateJson.json()).code).toBe(
      'INVALID_JSON'
    )
    expect(mockDatabase.getCanonicalAdminCmsSnapshot()).toEqual(
      afterReauthentication
    )

    expect(mockDatabase.getCanonicalAdminCmsSnapshot().questions).toHaveLength(
      65
    )
  })

  it('reauthentication은 4KiB와 actor/IP 5회/15분 rate parity를 유지한다', async () => {
    mockDatabase.loginAs('ADMIN', DEMO_ADMIN_ID)
    const oversized = await fetch(`${BASE}/reauthentication`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': String(4 * 1024 + 1),
        Origin: 'http://localhost'
      },
      body: '{}'
    })
    expect(oversized.status).toBe(413)

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const accepted = await jsonCommand('POST', '/reauthentication', {
        password: MOCK_ADMIN_PASSWORD
      })
      expect(accepted.status, `attempt ${attempt + 1}`).toBe(200)
    }
    const limited = await jsonCommand('POST', '/reauthentication', {
      password: MOCK_ADMIN_PASSWORD
    })
    expect(limited.status).toBe(429)
    expect(
      reauthenticateAdminErrorSchema.parse(await limited.json()).code
    ).toBe('RATE_LIMITED')
    expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0)
    expect(Number(limited.headers.get('Retry-After'))).toBeLessThanOrEqual(900)
  })

  it('A2 commands는 16KiB와 shared actor/IP 10회/15분 rate parity를 유지한다', async () => {
    mockDatabase.loginAs('ADMIN', DEMO_ADMIN_ID)
    const beforeOptions = mockDatabase.getCanonicalAdminCmsSnapshot()
    for (const pathname of [
      `/question-versions/${canonicalMissingId}/approval`,
      `/question-versions/${canonicalMissingId}/approval-withdrawal`
    ]) {
      const options = await fetch(`${BASE}${pathname}`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://localhost',
          'Access-Control-Request-Method': 'POST'
        }
      })
      expect(options.status).toBe(204)
      expect(options.headers.get('Access-Control-Allow-Origin')).toBe(
        'http://localhost'
      )
    }
    expect(mockDatabase.getCanonicalAdminCmsSnapshot()).toEqual(beforeOptions)

    const declaredOversized = await fetch(
      `${BASE}/question-versions/${canonicalMissingId}/approval`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': String(16 * 1024 + 1),
          Origin: 'http://localhost'
        },
        body: 'x'.repeat(16 * 1024 + 1)
      }
    )
    expect(declaredOversized.status).toBe(413)

    const actualOversized = await fetch(
      `${BASE}/question-versions/${canonicalMissingId}/approval`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost'
        },
        body: JSON.stringify({
          expectedRowVersion: 1,
          comment: 'x'.repeat(16 * 1024)
        })
      }
    )
    expect(actualOversized.status).toBe(413)

    resetAdminCmsCommandRateLimitForTesting()
    mockDatabase.loginAs('ADMIN', DEMO_REVIEWER_ADMIN_ID)
    const before = mockDatabase.getCanonicalAdminCmsSnapshot()
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const accepted = await jsonCommand(
        'POST',
        `/question-versions/${canonicalMissingId}/approval`,
        { expectedRowVersion: 1 }
      )
      expect(accepted.status, `attempt ${attempt + 1}`).toBe(404)
      expect(accepted.headers.get('Set-Cookie')).toBeNull()
    }
    const limited = await jsonCommand(
      'POST',
      `/question-versions/${canonicalMissingId}/approval-withdrawal`,
      { expectedRowVersion: 1, reason: 'FINAL_RECHECK' }
    )
    expect(limited.status).toBe(429)
    expect(apiFailureSchema.parse(await limited.json()).code).toBe(
      'RATE_LIMITED'
    )
    expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0)
    expect(Number(limited.headers.get('Retry-After'))).toBeLessThanOrEqual(900)
    expect(limited.headers.get('Set-Cookie')).toBeNull()
    expect(mockDatabase.getCanonicalAdminCmsSnapshot()).toEqual(before)
  })

  it('manifest의 dormant 12개 전부를 guard/state/cookie/audit 전에 generic 404로 닫는다', async () => {
    mockDatabase.loginAs('ADMIN', DEMO_ADMIN_ID)
    const before = mockDatabase.getCanonicalAdminCmsSnapshot()
    const activeState = mockDatabase.getPhase7AdminCmsStateForHandlers()
    expect(Object.keys(activeState).toSorted()).toEqual([
      'createQuestion',
      'createVersion',
      'hasFreshAssurance',
      'reauthenticate',
      'transitionVersion',
      'updateVersion'
    ])
    expect('publishQuestionVersion' in activeState).toBe(false)
    expect('retireQuestionVersion' in activeState).toBe(false)
    expect('archiveAdminQuestion' in activeState).toBe(false)
    expect('getLearnerProjection' in activeState).toBe(false)
    const authRead = vi.spyOn(mockDatabase, 'getCurrentUser')
    const stateRead = vi.spyOn(
      mockDatabase,
      'getPhase7AdminCmsStateForHandlers'
    )
    const sourceRead = vi.spyOn(
      mockDatabase,
      'listCanonicalAdminQuestionSources'
    )

    expect(phase7DormantAfterSlice3RA2OperationManifest).toHaveLength(12)
    for (const entry of phase7DormantAfterSlice3RA2OperationManifest) {
      const response = await fetch(
        `http://localhost${materializeManifestPath(entry.path)}`,
        {
          method: entry.method,
          headers: {
            'Content-Type': 'application/json',
            Origin: 'http://localhost'
          },
          ...(entry.method === 'GET' ? {} : { body: '{}' })
        }
      )

      expect(response.status, entry.operation).toBe(404)
      expect(apiFailureSchema.parse(await response.json())).toMatchObject({
        code: 'RESOURCE_NOT_FOUND',
        message: '요청한 경로를 찾을 수 없습니다.',
        retryable: false
      })
      expect(response.headers.get('Retry-After')).toBeNull()
      expect(response.headers.get('Set-Cookie')).toBeNull()
    }

    expect(authRead).not.toHaveBeenCalled()
    expect(stateRead).not.toHaveBeenCalled()
    expect(sourceRead).not.toHaveBeenCalled()
    authRead.mockRestore()
    stateRead.mockRestore()
    sourceRead.mockRestore()
    expect(mockDatabase.getCanonicalAdminCmsSnapshot()).toEqual(before)
  })

  it.each(
    [
      `/question-versions/${canonicalMissingId}/publication`,
      `/question-versions/${canonicalMissingId}/retirement`,
      `/questions/${canonicalMissingId}/archive`
    ].flatMap((canonicalPath) => [
      ['POST', canonicalPath],
      ['GET', canonicalPath],
      ['POST', `${canonicalPath}/`],
      ['POST', canonicalPath.replace('019d', '019D')],
      ['POST', `${canonicalPath}#alias`]
    ]) as readonly (readonly [string, string])[]
  )(
    '%s Slice 4P dormant alias %s is exact generic 404 with every caller/write at zero',
    async (method, pathname) => {
      mockDatabase.loginAs('ADMIN', DEMO_ADMIN_ID)
      const before = mockDatabase.getCanonicalAdminCmsSnapshot()
      const dormantRequestId = crypto.randomUUID()
      const authRead = vi.spyOn(mockDatabase, 'getCurrentUser')
      const stateRead = vi.spyOn(
        mockDatabase,
        'getPhase7AdminCmsStateForHandlers'
      )
      const sourceRead = vi.spyOn(
        mockDatabase,
        'listCanonicalAdminQuestionSources'
      )
      const response = await fetch(`${BASE}${pathname}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost',
          'X-Request-Id': dormantRequestId
        },
        ...(method === 'GET' ? {} : { body: '{}' })
      })

      expect(response.status).toBe(404)
      expect(apiFailureSchema.parse(await response.json())).toEqual({
        code: 'RESOURCE_NOT_FOUND',
        message: '요청한 경로를 찾을 수 없습니다.',
        requestId: dormantRequestId,
        retryable: false
      })
      expect(response.headers.get('Cache-Control')).toBe('private, no-store')
      expect(response.headers.get('X-Request-Id')).toBe(dormantRequestId)
      expect(response.headers.get('Retry-After')).toBeNull()
      expect(response.headers.get('Set-Cookie')).toBeNull()
      expect(authRead).not.toHaveBeenCalled()
      expect(stateRead).not.toHaveBeenCalled()
      expect(sourceRead).not.toHaveBeenCalled()
      authRead.mockRestore()
      stateRead.mockRestore()
      sourceRead.mockRestore()
      expect(mockDatabase.getCanonicalAdminCmsSnapshot()).toEqual(before)
    }
  )

  it('rejects a command fragment alias before auth, rate, and writes', async () => {
    mockDatabase.loginAs('ADMIN', DEMO_ADMIN_ID)
    const before = mockDatabase.getCanonicalAdminCmsSnapshot()
    const response = await fetch(`${BASE}/questions#alias`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost'
      },
      body: JSON.stringify({})
    })

    expect(response.status).toBe(404)
    expect(mockDatabase.getCanonicalAdminCmsSnapshot()).toEqual(before)
  })
})
