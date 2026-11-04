import { describe, expect, it } from 'vitest'

import {
  type AdminCommandAuthority,
  AdminQuestionCommandRepositoryError,
  type AdminQuestionPublicationCommandRepository
} from './adminQuestionCommandRepository.js'
import { createAdminQuestionPublicationCommandService } from './adminQuestionCommandService.js'

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
