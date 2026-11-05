import type { ReactElement } from 'react'
import { useParams } from 'react-router'

import { useAuth } from '@nihongo/browser/provider/ProtectedRouteProvider'
import { captureAuthTransitionEpoch } from '@nihongo/browser/libs/authTransitionFence'

import { QuestionCommandDialog } from '@app/admin-question/components/QuestionCommandDialog'
import { QuestionDetailBody } from '@app/admin-question/components/QuestionDetailBody'
import { QuestionDetailHeader } from '@app/admin-question/components/QuestionDetailHeader'
import { UnsavedChangesDialog } from '@app/admin-question/components/UnsavedChangesDialog'
import { useQuestionDetail } from '@app/admin-question/hooks/useQuestionDetail'
import { PageContainer } from '@nihongo/browser/common/components/PageContainer'

export const AdminQuestionDetailPage = (): ReactElement => {
  const { questionId = '' } = useParams()
  const { user, role } = useAuth()
  const epoch = captureAuthTransitionEpoch()
  return user && role === 'ADMIN' ? (
    <QuestionDetail
      key={`${user.id}:${epoch}:${questionId}`}
      questionId={questionId}
      actorId={user.id}
      epoch={epoch}
    />
  ) : (
    <></>
  )
}
const QuestionDetail = ({
  questionId,
  actorId,
  epoch
}: {
  questionId: string
  actorId: string
  epoch: number
}): ReactElement => {
  const state = useQuestionDetail({ questionId, actorId, epoch })
  return (
    <PageContainer width="6xl">
      <QuestionDetailHeader state={state} />
      <QuestionDetailBody state={state} />
      <QuestionCommandDialog state={state} />
      <UnsavedChangesDialog state={state} />
    </PageContainer>
  )
}
