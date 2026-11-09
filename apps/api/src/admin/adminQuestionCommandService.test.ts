import { describe, expect, it } from 'vitest'

import {
  type AdminCommandAuthority,
  type AdminQuestionCommandRepository,
  AdminQuestionCommandRepositoryError,
  type AdminQuestionPublicationCommandRepository
} from './adminQuestionCommandRepository.js'
import {
  createAdminQuestionCommandService,
  createAdminQuestionPublicationCommandService
} from './adminQuestionCommandService.js'

const authority = { actorId: 'actor-1' } as unknown as AdminCommandAuthority

const unexpected = () =>
  new AdminQuestionCommandRepositoryError({
    code: 'SERVICE_UNAVAILABLE',
    message: '일시적으로 처리할 수 없습니다.',
    disposition: 'DEFINITE_ROLLBACK'
  })

const createRepository = (
  failing: ReadonlySet<string>
): AdminQuestionPublicationCommandRepository =>
  ({
    readPublicationTarget: async () => ({
      questionRowVersion: 1,
      versionStatus: 'APPROVED'
    }),
    publishVersion: async (_authority: unknown, versionId: string) => {
      if (failing.has(versionId)) {
        throw unexpected()
      }
      return { versionRowVersion: 2 }
    }
  }) as unknown as AdminQuestionPublicationCommandRepository

const items = (...ids: string[]) =>
  ids.map((questionVersionId) => ({ questionVersionId, expectedRowVersion: 1 }))

describe('publishVersionBatch partial failure', () => {
  it('reports an unexpected failure after a publish as FAILED and continues', async () => {
    const service = createAdminQuestionPublicationCommandService(
      createRepository(new Set(['v2']))
    )

    const response = await service.publishVersionBatch(authority, {
      items: items('v1', 'v2', 'v3')
    })

    expect(response).toEqual({
      publishedCount: 2,
      items: [
        { questionVersionId: 'v1', result: 'PUBLISHED', rowVersion: 2 },
        { questionVersionId: 'v2', result: 'FAILED', rowVersion: null },
        { questionVersionId: 'v3', result: 'PUBLISHED', rowVersion: 2 }
      ]
    })
  })

  it('throws when nothing was published yet', async () => {
    const service = createAdminQuestionPublicationCommandService(
      createRepository(new Set(['v1']))
    )

    await expect(
      service.publishVersionBatch(authority, { items: items('v1', 'v2') })
    ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' })
  })
})

const failure = (code: 'VERSION_CONFLICT' | 'INVALID_STATE_TRANSITION') =>
  new AdminQuestionCommandRepositoryError({
    code,
    message: '실패',
    disposition: 'DEFINITE_ROLLBACK'
  })

const createApprovalRepository = (
  failures: Readonly<Record<string, () => Error>>
): AdminQuestionCommandRepository =>
  ({
    transitionVersion: async (
      operation: string,
      _authority: unknown,
      versionId: string
    ) => {
      expect(operation).toBe('approveQuestionVersion')
      const fail = failures[versionId]
      if (fail) throw fail()
      return { versionRowVersion: 3 }
    }
  }) as unknown as AdminQuestionCommandRepository

describe('approveVersionBatch (#709)', () => {
  it('maps item outcomes and keeps going after an unexpected failure', async () => {
    const service = createAdminQuestionCommandService(
      createApprovalRepository({
        v2: () => failure('VERSION_CONFLICT'),
        v3: () => failure('INVALID_STATE_TRANSITION'),
        v4: unexpected
      })
    )

    await expect(
      service.approveVersionBatch(authority, {
        items: items('v1', 'v2', 'v3', 'v4')
      })
    ).resolves.toEqual({
      approvedCount: 1,
      items: [
        { questionVersionId: 'v1', result: 'APPROVED', rowVersion: 3 },
        {
          questionVersionId: 'v2',
          result: 'VERSION_CONFLICT',
          rowVersion: null
        },
        { questionVersionId: 'v3', result: 'NOT_IN_REVIEW', rowVersion: null },
        { questionVersionId: 'v4', result: 'FAILED', rowVersion: null }
      ]
    })
  })

  it('throws when nothing was approved yet', async () => {
    const service = createAdminQuestionCommandService(
      createApprovalRepository({ v1: unexpected })
    )

    await expect(
      service.approveVersionBatch(authority, { items: items('v1', 'v2') })
    ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' })
  })
})

describe('retireVersionBatch (JLP-816)', () => {
  it('sends the whole batch to one repository call', async () => {
    const calls: unknown[] = []
    const service = createAdminQuestionPublicationCommandService({
      retireVersionBatch: async (_authority: unknown, request: unknown) => {
        calls.push(request)
        return {
          retiredCount: 1,
          items: [
            {
              questionId: 'q1',
              questionVersionId: 'v1',
              questionRowVersion: 2,
              rowVersion: 2
            }
          ]
        }
      }
    } as unknown as AdminQuestionPublicationCommandRepository)

    await expect(
      service.retireVersionBatch(authority, { items: items('v1') })
    ).resolves.toMatchObject({ retiredCount: 1 })
    expect(calls).toEqual([{ items: items('v1') }])
  })

  it('fails the whole batch with the item failure code', async () => {
    const service = createAdminQuestionPublicationCommandService({
      retireVersionBatch: async () => {
        throw failure('INVALID_STATE_TRANSITION')
      }
    } as unknown as AdminQuestionPublicationCommandRepository)

    await expect(
      service.retireVersionBatch(authority, { items: items('v1', 'v2') })
    ).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION' })
  })
})
