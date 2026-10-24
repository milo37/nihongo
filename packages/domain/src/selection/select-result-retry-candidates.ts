export interface ResultRetrySourceCandidate {
  readonly isCorrect: boolean
  readonly ordinal: number
  readonly questionId: string | null
  readonly questionLifecycleStatus: 'ACTIVE' | 'ARCHIVED' | null
  readonly questionVersionId: string | null
  readonly questionVersionStatus: 'DRAFT' | 'PUBLISHED' | 'RETIRED' | null
}

export interface ResultRetryCandidate {
  readonly ordinal: number
  readonly questionId: string
  readonly questionVersionId: string
}

export interface ResultRetrySelection {
  readonly candidates: readonly ResultRetryCandidate[]
  readonly requestedCount: number
}

export class ResultRetrySelectionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ResultRetrySelectionError'
  }
}

export const selectResultRetryCandidates = (
  source: readonly ResultRetrySourceCandidate[]
): ResultRetrySelection => {
  const requestedCount = source.filter(({ isCorrect }) => !isCorrect).length
  const candidates = source
    .filter(
      (
        candidate
      ): candidate is ResultRetrySourceCandidate & {
        questionId: string
        questionVersionId: string
      } =>
        !candidate.isCorrect &&
        candidate.questionLifecycleStatus === 'ACTIVE' &&
        (candidate.questionVersionStatus === 'PUBLISHED' ||
          candidate.questionVersionStatus === 'RETIRED') &&
        candidate.questionId !== null &&
        candidate.questionId.trim().length > 0 &&
        candidate.questionVersionId !== null &&
        candidate.questionVersionId.trim().length > 0
    )
    .toSorted((left, right) => {
      if (left.ordinal !== right.ordinal) {
        return left.ordinal - right.ordinal
      }
      return left.questionId.localeCompare(right.questionId)
    })
    .map(({ ordinal, questionId, questionVersionId }) => ({
      ordinal,
      questionId,
      questionVersionId
    }))

  const questionIds = new Set<string>()
  const versionIds = new Set<string>()
  for (const candidate of candidates) {
    if (!Number.isSafeInteger(candidate.ordinal) || candidate.ordinal < 1) {
      throw new ResultRetrySelectionError(
        'source retry candidate ordinal은 1 이상의 safe integer여야 합니다.'
      )
    }
    if (
      questionIds.has(candidate.questionId) ||
      versionIds.has(candidate.questionVersionId)
    ) {
      throw new ResultRetrySelectionError(
        'retry candidate의 stable Question과 pinned version은 중복될 수 없습니다.'
      )
    }
    questionIds.add(candidate.questionId)
    versionIds.add(candidate.questionVersionId)
  }

  return { requestedCount, candidates }
}
