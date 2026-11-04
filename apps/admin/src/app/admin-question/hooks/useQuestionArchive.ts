import { useState } from 'react'
import { useToast } from '@nihongo/browser/common/components/Toast'
import { useDeleteAdminQuestion } from '@app/admin-question/hooks/useDeleteAdminQuestion'
import {
  isDraftOnly,
  type AdminQuestionSummary
} from '@app/admin-question/components/QuestionListTable'
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'

type RefetchList = () => Promise<{
  isError: boolean
  data?: { items: AdminQuestionSummary[] }
}>

/** Archive dialog state: target question, archive command and stale refresh. */
export const useQuestionArchive = (refetchList: RefetchList) => {
  const { t } = useAdminPresentation()
  const [refreshFailed, setRefreshFailed] = useState(false)
  const [question, setQuestion] = useState<AdminQuestionSummary | null>(null)
  const deleteQuestion = useDeleteAdminQuestion()
  const { addToast } = useToast()
  const error = deleteQuestion.apiError
  const needsFresh = error?.code === 'FRESH_ASSURANCE_REQUIRED'
  const conflict = error?.code === 'VERSION_CONFLICT'

  const open = (next: AdminQuestionSummary): void => {
    deleteQuestion.reset()
    setRefreshFailed(false)
    setQuestion(next)
  }

  const archive = async (): Promise<void> => {
    if (!question) {
      return
    }

    try {
      await deleteQuestion.mutateAsync({
        questionId: question.questionId,
        input: {
          expectedQuestionRowVersion: question.questionRowVersion,
          expectedOpenCandidateVersionId: question.openCandidateVersionId,
          expectedOpenCandidateRowVersion: question.openCandidateVersionId
            ? question.versionRowVersion
            : null
        }
      })
      const copy = isDraftOnly(question)
        ? 'questionList.draftDialog'
        : 'questionList.archiveDialog'
      addToast({
        title: t(`${copy}.successTitle`),
        description: t(`${copy}.successDescription`, {
          questionId: question.questionId
        }),
        variant: 'success'
      })
      setQuestion(null)
    } catch {
      // The dialog shows the error-code message.
    }
  }

  const refresh = (): void => {
    void refetchList().then((result) => {
      if (result.isError || !result.data) {
        setRefreshFailed(true)
        return
      }
      const next = result.data.items.find(
        (item) => item.questionId === question?.questionId
      )
      setQuestion(next ?? null)
      deleteQuestion.reset()
      setRefreshFailed(false)
    })
  }

  return {
    question,
    open,
    close: () => setQuestion(null),
    archive,
    refresh,
    refreshFailed,
    needsFresh,
    conflict,
    isPending: deleteQuestion.isPending,
    isError: deleteQuestion.isError,
    error: deleteQuestion.error
  }
}
