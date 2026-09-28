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
  resource: string
): Data => {
  if (!result.isSuccess || result.data === undefined) {
    throw new Error(`${resource}을(를) 최신 상태로 불러오지 못했습니다.`)
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
  const detailBefore = requireSuccessfulData(await refetchDetail(), '문제 상세')
  const preview = requireSuccessfulData(await refetchPreview(), '문제 미리보기')
  const history = requireSuccessfulData(await refetchHistory(), '버전 기록')
  if (refetchDiff) {
    requireSuccessfulData(await refetchDiff(), '버전 차이')
  }
  const detailAfter = requireSuccessfulData(
    await refetchDetail(),
    '문제 상세 재확인'
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
    throw new Error(
      '충돌 확인 중 버전이 다시 변경됐습니다. 최신본을 다시 불러와 주세요.'
    )
  }

  return { rowVersion: afterRowVersion }
}
