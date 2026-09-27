import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import type {
  CreateAdminQuestionRequest,
  UpdateQuestionVersionRequest
} from '@nihongo/contracts/admin/phase7'
import { ApplicationError } from '../errors/applicationError.js'
import {
  AdminQuestionCommandRepositoryError,
  type AdminCommandAuthority,
  type AdminQuestionPreparedCommandRepository
} from './adminQuestionCommandRepository.js'
import {
  createAdminQuestionCommandService,
  createAdminQuestionPublicationCommandService
} from './adminQuestionCommandService.js'

const authority: AdminCommandAuthority = {
  actorId: '019d0000-0000-7000-8000-000000000001',
  rawSessionToken: 'phase7-session-token',
  requestId: '019d0000-0000-7000-8000-000000000002'
}
const questionId = '019d0000-0000-7000-8000-000000000003'
const versionId = '019d0000-0000-7000-8000-000000000004'
const optionIds = [
  '019d0000-0000-7000-8000-000000000011',
  '019d0000-0000-7000-8000-000000000012',
  '019d0000-0000-7000-8000-000000000013',
  '019d0000-0000-7000-8000-000000000014'
] as const
const content: CreateAdminQuestionRequest = {
  level: 'N5',
  subject: 'GRAMMAR',
  questionType: 'GRAMMAR_SELECT',
  difficulty: 'NORMAL',
  questionText: '빈칸에 알맞은 표현을 고르세요.',
  passage: null,
  explanationKo: '문법 설명입니다.',
  explanationJa: null,
  tagNames: ['문법'],
  options: [
    { clientOptionKey: 'a', text: 'です' },
    { clientOptionKey: 'b', text: 'ます' },
    { clientOptionKey: 'c', text: 'でした' },
    { clientOptionKey: 'd', text: 'ません' }
  ],
  correctOptionKey: 'a'
}
const update: UpdateQuestionVersionRequest = {
  level: content.level,
  subject: content.subject,
  questionType: content.questionType,
  difficulty: content.difficulty,
  questionText: content.questionText,
  passage: content.passage,
  explanationKo: content.explanationKo,
  explanationJa: content.explanationJa,
  tagNames: content.tagNames,
  options: content.options.map((option, index) => ({
    id: optionIds[index]!,
    ordinal: index + 1,
    text: option.text
  })),
  correctOptionId: optionIds[0],
  expectedRowVersion: 1
}
const result = {
  questionId,
  questionVersionId: versionId,
  lifecycleStatus: 'ACTIVE',
  versionStatus: 'DRAFT',
  questionRowVersion: 1,
  versionRowVersion: 1,
  occurredAt: '2026-09-06T00:00:00.000Z'
} as const

const createRepository = (): AdminQuestionPreparedCommandRepository => ({
  createQuestion: vi.fn(async () => result),
  createVersion: vi.fn(async () => result),
  updateVersion: vi.fn(async () => result),
  transitionVersion: vi.fn(async () => result),
  publishVersion: vi.fn(async () => result),
  retireVersion: vi.fn(async () => result),
  archiveQuestion: vi.fn(async () => result)
})

describe('Phase 7 ADMIN question command service', () => {
  it('keeps prepared publication factories and paths out of production composition', () => {
    const productionSources = [
      readFileSync(new URL('../server.ts', import.meta.url), 'utf8'),
      readFileSync(
        new URL('../routes/adminQuestionCommands.ts', import.meta.url),
        'utf8'
      )
    ].join('\n')

    expect(productionSources).not.toMatch(
      /createPreparedAdminQuestionCommandRepository|createAdminQuestionPublicationCommandService|publishVersion|retireVersion|archiveQuestion|\/publication|\/retirement|\/archive/u
    )
  })

  it('delegates all ten prepared domain operations without changing authority or payloads', async () => {
    const repository = createRepository()
    const activeService = createAdminQuestionCommandService(repository)
    const publicationService =
      createAdminQuestionPublicationCommandService(repository)
    const service = { ...activeService, ...publicationService }

    expect(Object.keys(activeService).toSorted()).toEqual([
      'approveVersion',
      'createQuestion',
      'createVersion',
      'requestChanges',
      'requestReview',
      'updateVersion',
      'withdrawApproval'
    ])
    expect('publishVersion' in activeService).toBe(false)
    expect('retireVersion' in activeService).toBe(false)
    expect('archiveQuestion' in activeService).toBe(false)
    expect(Object.keys(publicationService).toSorted()).toEqual([
      'archiveQuestion',
      'publishVersion',
      'retireVersion'
    ])

    await expect(service.createQuestion(authority, content)).resolves.toBe(
      result
    )
    await expect(
      service.createVersion(authority, questionId, {
        ...content,
        expectedQuestionRowVersion: 1
      })
    ).resolves.toBe(result)
    await expect(
      service.updateVersion(authority, versionId, update)
    ).resolves.toBe(result)
    await expect(
      service.requestReview(authority, versionId, {
        expectedRowVersion: 1,
        comment: '검수를 요청합니다.'
      })
    ).resolves.toBe(result)
    await expect(
      service.requestChanges(authority, versionId, {
        expectedRowVersion: 2,
        reason: '해설 보완',
        comment: '근거를 추가해 주세요.'
      })
    ).resolves.toBe(result)
    await expect(
      service.approveVersion(authority, versionId, {
        expectedRowVersion: 3,
        comment: '승인합니다.'
      })
    ).resolves.toBe(result)
    await expect(
      service.withdrawApproval(authority, versionId, {
        expectedRowVersion: 4,
        reason: '최종 재검토'
      })
    ).resolves.toBe(result)
    await expect(
      service.publishVersion(authority, versionId, {
        expectedRowVersion: 5,
        expectedQuestionRowVersion: 1
      })
    ).resolves.toBe(result)
    await expect(
      service.retireVersion(authority, versionId, {
        expectedRowVersion: 6,
        expectedQuestionRowVersion: 2
      })
    ).resolves.toBe(result)
    await expect(
      service.archiveQuestion(authority, questionId, {
        expectedQuestionRowVersion: 3,
        expectedOpenCandidateVersionId: null,
        expectedOpenCandidateRowVersion: null
      })
    ).resolves.toBe(result)

    expect(repository.createQuestion).toHaveBeenCalledWith(authority, content)
    expect(repository.createVersion).toHaveBeenCalledWith(
      authority,
      questionId,
      { ...content, expectedQuestionRowVersion: 1 }
    )
    expect(repository.updateVersion).toHaveBeenCalledWith(
      authority,
      versionId,
      update
    )
    expect(repository.transitionVersion).toHaveBeenNthCalledWith(
      1,
      'requestContentReview',
      authority,
      versionId,
      { expectedRowVersion: 1, comment: '검수를 요청합니다.' }
    )
    expect(repository.transitionVersion).toHaveBeenNthCalledWith(
      2,
      'requestQuestionChanges',
      authority,
      versionId,
      {
        expectedRowVersion: 2,
        reason: '해설 보완',
        comment: '근거를 추가해 주세요.'
      }
    )
    expect(repository.transitionVersion).toHaveBeenNthCalledWith(
      3,
      'approveQuestionVersion',
      authority,
      versionId,
      { expectedRowVersion: 3, comment: '승인합니다.' }
    )
    expect(repository.transitionVersion).toHaveBeenNthCalledWith(
      4,
      'withdrawQuestionApproval',
      authority,
      versionId,
      { expectedRowVersion: 4, reason: '최종 재검토' }
    )
    expect(repository.publishVersion).toHaveBeenCalledWith(
      authority,
      versionId,
      { expectedRowVersion: 5, expectedQuestionRowVersion: 1 }
    )
    expect(repository.retireVersion).toHaveBeenCalledWith(
      authority,
      versionId,
      { expectedRowVersion: 6, expectedQuestionRowVersion: 2 }
    )
    expect(repository.archiveQuestion).toHaveBeenCalledWith(
      authority,
      questionId,
      {
        expectedQuestionRowVersion: 3,
        expectedOpenCandidateVersionId: null,
        expectedOpenCandidateRowVersion: null
      }
    )
  })

  it('preserves repository error code, disposition, internal reason and retry metadata', async () => {
    const repository = createRepository()
    const cause = new AdminQuestionCommandRepositoryError({
      code: 'SERVICE_UNAVAILABLE',
      message: '동시 중복을 확정할 수 없습니다.',
      disposition: 'DEFINITE_ROLLBACK',
      internalReason: 'CONTENT_DUPLICATE_CONCURRENT_RACE',
      retryAfterSeconds: 7
    })
    vi.mocked(repository.createQuestion).mockRejectedValueOnce(cause)

    try {
      await createAdminQuestionCommandService(repository).createQuestion(
        authority,
        content
      )
      throw new Error('Expected command service failure.')
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(ApplicationError)
      expect(error).toMatchObject({
        code: 'SERVICE_UNAVAILABLE',
        retryable: false,
        retryAfterSeconds: 7,
        phase7Disposition: 'DEFINITE_ROLLBACK',
        phase7InternalReason: 'CONTENT_DUPLICATE_CONCURRENT_RACE'
      })
      expect((error as Error).cause).toBe(cause)
    }
  })

  it('does not relabel an unknown repository failure', async () => {
    const repository = createRepository()
    const failure = new Error('unknown adapter failure')
    vi.mocked(repository.createQuestion).mockRejectedValueOnce(failure)

    await expect(
      createAdminQuestionCommandService(repository).createQuestion(
        authority,
        content
      )
    ).rejects.toBe(failure)
  })
})
