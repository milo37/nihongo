import type {
  StudyDraftAnswer,
  StudyDraftSnapshot
} from '@nihongo/contracts/study/study-draft'
import type { ParsedSaveStudyDraftAnswersRequest } from '@api/study/saveStudyDraftAnswers/schema'

export interface StudyDraftAnswerDiff {
  elapsedSec?: number
  selectedOptionId?: string | null
}

export interface StudyDraftLocalDiff {
  answers: Record<string, StudyDraftAnswerDiff>
  currentOrdinal?: number
}

export type StudyDraftConflict =
  | {
      field: 'selectedOptionId' | 'elapsedSec'
      studySessionQuestionId: string
      base: number | string | null
      local: number | string | null
      remote: number | string | null
    }
  | {
      field: 'currentOrdinal'
      base: number
      local: number
      remote: number
    }

export interface StudyDraftMergeResult {
  autoMerged: StudyDraftSnapshot
  conflicts: StudyDraftConflict[]
  localPreferred: StudyDraftSnapshot
}

export const createEmptyStudyDraftDiff = (): StudyDraftLocalDiff => ({
  answers: {}
})

export const isStudyDraftDiffEmpty = (diff: StudyDraftLocalDiff): boolean =>
  diff.currentOrdinal === undefined && Object.keys(diff.answers).length === 0

const mergeAnswer = (
  answer: StudyDraftAnswer,
  diff: StudyDraftAnswerDiff | undefined
): StudyDraftAnswer => ({
  ...answer,
  ...(diff?.selectedOptionId === undefined
    ? {}
    : { selectedOptionId: diff.selectedOptionId }),
  ...(diff?.elapsedSec === undefined ? {} : { elapsedSec: diff.elapsedSec })
})

export const applyStudyDraftDiff = (
  base: StudyDraftSnapshot,
  diff: StudyDraftLocalDiff
): StudyDraftSnapshot => ({
  ...base,
  answers: base.answers.map((answer) =>
    mergeAnswer(answer, diff.answers[answer.studySessionQuestionId])
  ),
  currentOrdinal: diff.currentOrdinal ?? base.currentOrdinal
})

export const diffStudyDraftSnapshots = (
  base: StudyDraftSnapshot,
  target: StudyDraftSnapshot
): StudyDraftLocalDiff => {
  const targetById = new Map(
    target.answers.map((answer) => [answer.studySessionQuestionId, answer])
  )
  const answers: Record<string, StudyDraftAnswerDiff> = {}

  for (const baseAnswer of base.answers) {
    const targetAnswer = targetById.get(baseAnswer.studySessionQuestionId)
    if (!targetAnswer) {
      continue
    }

    const answerDiff: StudyDraftAnswerDiff = {}
    if (baseAnswer.selectedOptionId !== targetAnswer.selectedOptionId) {
      answerDiff.selectedOptionId = targetAnswer.selectedOptionId
    }
    if (baseAnswer.elapsedSec !== targetAnswer.elapsedSec) {
      answerDiff.elapsedSec = targetAnswer.elapsedSec
    }
    if (Object.keys(answerDiff).length > 0) {
      answers[baseAnswer.studySessionQuestionId] = answerDiff
    }
  }

  return {
    answers,
    ...(base.currentOrdinal === target.currentOrdinal
      ? {}
      : { currentOrdinal: target.currentOrdinal })
  }
}

export const mergeStudyDraftDiffs = (
  first: StudyDraftLocalDiff,
  second: StudyDraftLocalDiff
): StudyDraftLocalDiff => {
  const answers: Record<string, StudyDraftAnswerDiff> = {
    ...first.answers
  }

  for (const [questionId, answerDiff] of Object.entries(second.answers)) {
    answers[questionId] = {
      ...answers[questionId],
      ...answerDiff
    }
  }

  return {
    answers,
    ...(second.currentOrdinal !== undefined
      ? { currentOrdinal: second.currentOrdinal }
      : first.currentOrdinal === undefined
        ? {}
        : { currentOrdinal: first.currentOrdinal })
  }
}

export const toSaveStudyDraftBody = (
  base: StudyDraftSnapshot,
  diff: StudyDraftLocalDiff
): ParsedSaveStudyDraftAnswersRequest => {
  const local = applyStudyDraftDiff(base, diff)
  return {
    expectedRevision: base.revision,
    currentOrdinal: local.currentOrdinal,
    answers: local.answers.map(
      ({ studySessionQuestionId, selectedOptionId, elapsedSec }) => ({
        studySessionQuestionId,
        selectedOptionId,
        elapsedSec
      })
    )
  }
}

export const applySaveStudyDraftBody = (
  base: StudyDraftSnapshot,
  body: ParsedSaveStudyDraftAnswersRequest
): StudyDraftSnapshot => ({
  ...base,
  answers: body.answers.map((answer) => ({ ...answer })),
  currentOrdinal: body.currentOrdinal
})

const resolveScalar = <Value extends number | string | null>({
  base,
  field,
  local,
  remote,
  studySessionQuestionId,
  conflicts,
  conflictWhenSameChange = false
}: {
  base: Value
  field: 'elapsedSec' | 'selectedOptionId'
  local: Value
  remote: Value
  studySessionQuestionId: string
  conflicts: StudyDraftConflict[]
  conflictWhenSameChange?: boolean
}): { auto: Value; localPreferred: Value } => {
  const localChanged = local !== base
  const remoteChanged = remote !== base

  if (!localChanged) {
    return { auto: remote, localPreferred: remote }
  }
  if (!remoteChanged) {
    return { auto: local, localPreferred: local }
  }
  if (!conflictWhenSameChange && local === remote) {
    return { auto: local, localPreferred: local }
  }

  conflicts.push({
    field,
    studySessionQuestionId,
    base,
    local,
    remote
  })
  return { auto: remote, localPreferred: local }
}

export const mergeStudyDraftSnapshots = (
  base: StudyDraftSnapshot,
  local: StudyDraftSnapshot,
  remote: StudyDraftSnapshot
): StudyDraftMergeResult => {
  const localById = new Map(
    local.answers.map((answer) => [answer.studySessionQuestionId, answer])
  )
  const baseById = new Map(
    base.answers.map((answer) => [answer.studySessionQuestionId, answer])
  )
  const conflicts: StudyDraftConflict[] = []
  const localPreferredAnswers: StudyDraftAnswer[] = []
  const autoAnswers = remote.answers.map((remoteAnswer) => {
    const baseAnswer = baseById.get(remoteAnswer.studySessionQuestionId)
    const localAnswer = localById.get(remoteAnswer.studySessionQuestionId)

    if (!baseAnswer || !localAnswer) {
      localPreferredAnswers.push(remoteAnswer)
      return remoteAnswer
    }

    const selected = resolveScalar({
      base: baseAnswer.selectedOptionId,
      field: 'selectedOptionId',
      local: localAnswer.selectedOptionId,
      remote: remoteAnswer.selectedOptionId,
      studySessionQuestionId: remoteAnswer.studySessionQuestionId,
      conflicts
    })
    const elapsed = resolveScalar({
      base: baseAnswer.elapsedSec,
      conflictWhenSameChange: true,
      field: 'elapsedSec',
      local: localAnswer.elapsedSec,
      remote: remoteAnswer.elapsedSec,
      studySessionQuestionId: remoteAnswer.studySessionQuestionId,
      conflicts
    })
    localPreferredAnswers.push({
      ...remoteAnswer,
      selectedOptionId: selected.localPreferred,
      elapsedSec: elapsed.localPreferred
    })
    return {
      ...remoteAnswer,
      selectedOptionId: selected.auto,
      elapsedSec: elapsed.auto
    }
  })

  const localOrdinalChanged = local.currentOrdinal !== base.currentOrdinal
  const remoteOrdinalChanged = remote.currentOrdinal !== base.currentOrdinal
  let autoOrdinal = remote.currentOrdinal
  let localPreferredOrdinal = remote.currentOrdinal

  if (localOrdinalChanged && !remoteOrdinalChanged) {
    autoOrdinal = local.currentOrdinal
    localPreferredOrdinal = local.currentOrdinal
  } else if (localOrdinalChanged && remoteOrdinalChanged) {
    localPreferredOrdinal = local.currentOrdinal
    if (local.currentOrdinal === remote.currentOrdinal) {
      autoOrdinal = local.currentOrdinal
    } else {
      conflicts.push({
        field: 'currentOrdinal',
        base: base.currentOrdinal,
        local: local.currentOrdinal,
        remote: remote.currentOrdinal
      })
    }
  }

  return {
    autoMerged: {
      ...remote,
      answers: autoAnswers,
      currentOrdinal: autoOrdinal
    },
    conflicts,
    localPreferred: {
      ...remote,
      answers: localPreferredAnswers,
      currentOrdinal: localPreferredOrdinal
    }
  }
}
