interface RefetchResult<Data> {
  readonly data?: Data
  readonly isSuccess: boolean
}

interface VersionSummary {
  readonly questionVersionId: string
  readonly rowVersion: number
}

interface DetailSnapshot {
  readonly versions: {
    readonly items: readonly VersionSummary[]
  }
}

interface HistorySnapshot {
  readonly pages: ReadonlyArray<{
    readonly items: readonly VersionSummary[]
  }>
}

interface PreviewSnapshot {
  readonly question: {
    readonly questionVersionId: string
  }
}

export type Phase7ConflictRefreshErrorCode =
  | 'REFETCH_FAILED'
  | 'SNAPSHOT_CHANGED'

type Phase7ConflictRefreshResource =
  | 'DETAIL_AFTER'
  | 'DETAIL_BEFORE'
  | 'DIFF'
  | 'HISTORY'
  | 'PREVIEW'

export class Phase7ConflictRefreshError extends Error {
  readonly code: Phase7ConflictRefreshErrorCode
  readonly resource?: Phase7ConflictRefreshResource

  constructor(
    code: Phase7ConflictRefreshErrorCode,
    resource?: Phase7ConflictRefreshResource
  ) {
    super(code)
    this.name = 'Phase7ConflictRefreshError'
    this.code = code
    this.resource = resource
  }
}

interface RefreshPhase7ConflictSnapshotInput<
  Detail extends DetailSnapshot,
  History extends HistorySnapshot,
  Preview extends PreviewSnapshot
> {
  readonly questionVersionId: string
  readonly refetchDetail: () => Promise<RefetchResult<Detail>>
  readonly refetchDiff?: () => Promise<RefetchResult<unknown>>
  readonly refetchHistory: () => Promise<RefetchResult<History>>
  readonly refetchPreview: () => Promise<RefetchResult<Preview>>
}

const requireSuccessfulData = <Data>(
  result: RefetchResult<Data>,
  resource: Phase7ConflictRefreshResource
): Data => {
  if (!result.isSuccess || result.data === undefined) {
    throw new Phase7ConflictRefreshError('REFETCH_FAILED', resource)
  }
  return result.data
}

const detailRowVersion = (
  detail: DetailSnapshot,
  questionVersionId: string
): number | undefined =>
  detail.versions.items.find(
    (version) => version.questionVersionId === questionVersionId
  )?.rowVersion

const historyRowVersion = (
  history: HistorySnapshot,
  questionVersionId: string
): number | undefined =>
  history.pages
    .flatMap((page) => page.items)
    .find((version) => version.questionVersionId === questionVersionId)
    ?.rowVersion

export const refreshPhase7ConflictSnapshot = async <
  Detail extends DetailSnapshot,
  History extends HistorySnapshot,
  Preview extends PreviewSnapshot
>({
  questionVersionId,
  refetchDetail,
  refetchDiff,
  refetchHistory,
  refetchPreview
}: RefreshPhase7ConflictSnapshotInput<Detail, History, Preview>): Promise<{
  readonly rowVersion: number
}> => {
  const detailBefore = requireSuccessfulData(
    await refetchDetail(),
    'DETAIL_BEFORE'
  )
  const preview = requireSuccessfulData(await refetchPreview(), 'PREVIEW')
  const history = requireSuccessfulData(await refetchHistory(), 'HISTORY')
  if (refetchDiff) {
    requireSuccessfulData(await refetchDiff(), 'DIFF')
  }
  const detailAfter = requireSuccessfulData(
    await refetchDetail(),
    'DETAIL_AFTER'
  )

  const beforeRowVersion = detailRowVersion(detailBefore, questionVersionId)
  const historyVersion = historyRowVersion(history, questionVersionId)
  const afterRowVersion = detailRowVersion(detailAfter, questionVersionId)
  if (
    preview.question.questionVersionId !== questionVersionId ||
    beforeRowVersion === undefined ||
    historyVersion === undefined ||
    afterRowVersion === undefined ||
    beforeRowVersion !== historyVersion ||
    historyVersion !== afterRowVersion
  ) {
    throw new Phase7ConflictRefreshError('SNAPSHOT_CHANGED')
  }

  return { rowVersion: afterRowVersion }
}
