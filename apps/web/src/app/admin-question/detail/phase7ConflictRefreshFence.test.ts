import { describe, expect, it, vi } from 'vitest'
import { refreshPhase7ConflictSnapshot } from '@app/admin-question/detail/phase7ConflictRefreshFence'

const versionId = '00000000-0000-4000-8000-000000000001'
const detail = (rowVersion: number) => ({
  versions: { items: [{ questionVersionId: versionId, rowVersion }] }
})
const history = (rowVersion: number) => ({
  pages: [{ items: [{ questionVersionId: versionId, rowVersion }] }]
})
const preview = {
  question: { questionVersionId: versionId }
}

describe('Phase 7 conflict refresh fence', () => {
  it('accepts only a successful same-rowVersion detail/preview/history snapshot', async () => {
    const refetchDetail = vi
      .fn()
      .mockResolvedValueOnce({ isSuccess: true, data: detail(4) })
      .mockResolvedValueOnce({ isSuccess: true, data: detail(4) })

    await expect(
      refreshPhase7ConflictSnapshot({
        questionVersionId: versionId,
        refetchDetail,
        refetchDiff: vi
          .fn()
          .mockResolvedValue({ isSuccess: true, data: { changedFields: [] } }),
        refetchHistory: vi
          .fn()
          .mockResolvedValue({ isSuccess: true, data: history(4) }),
        refetchPreview: vi
          .fn()
          .mockResolvedValue({ isSuccess: true, data: preview })
      })
    ).resolves.toEqual({ rowVersion: 4 })
    expect(refetchDetail).toHaveBeenCalledTimes(2)
  })

  it('rejects a resolved refetch error instead of approving stale cached data', async () => {
    await expect(
      refreshPhase7ConflictSnapshot({
        questionVersionId: versionId,
        refetchDetail: vi
          .fn()
          .mockResolvedValue({ isSuccess: true, data: detail(4) }),
        refetchHistory: vi
          .fn()
          .mockResolvedValue({ isSuccess: true, data: history(4) }),
        refetchPreview: vi
          .fn()
          .mockResolvedValue({ isSuccess: false, data: preview })
      })
    ).rejects.toMatchObject({ code: 'REFETCH_FAILED', resource: 'PREVIEW' })
  })

  it('rejects a torn snapshot when a concurrent write changes rowVersion', async () => {
    const refetchDetail = vi
      .fn()
      .mockResolvedValueOnce({ isSuccess: true, data: detail(4) })
      .mockResolvedValueOnce({ isSuccess: true, data: detail(5) })

    await expect(
      refreshPhase7ConflictSnapshot({
        questionVersionId: versionId,
        refetchDetail,
        refetchHistory: vi
          .fn()
          .mockResolvedValue({ isSuccess: true, data: history(4) }),
        refetchPreview: vi
          .fn()
          .mockResolvedValue({ isSuccess: true, data: preview })
      })
    ).rejects.toMatchObject({ code: 'SNAPSHOT_CHANGED' })
  })
})
