import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type { CreateQuestionReportRequest } from '@nihongo/contracts/admin/phase7'
import { isPhase7UiApiError } from '@app/admin-question/hooks/usePhase7AdminMutations'
import { useCreatePhase7QuestionReport } from '@app/question-report/hooks/useCreatePhase7QuestionReport'
import { Button } from '@common/components/Button'
import { Dialog } from '@common/components/Dialog'
import { Select } from '@common/components/Select'
import { Textarea } from '@common/components/Textarea'

const reasons = [
  'ANSWER_ERROR',
  'EXPLANATION_ERROR',
  'TYPO_OR_GRAMMAR',
  'AMBIGUOUS',
  'LEVEL_OR_TAXONOMY',
  'OTHER'
] as const

interface QuestionReportDialogProps {
  readonly questionId: string
  readonly questionVersionId: string
}

export const QuestionReportDialog = ({
  questionId,
  questionVersionId
}: QuestionReportDialogProps): ReactElement => {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const reasonRef = useRef<HTMLSelectElement>(null)
  const descriptionRef = useRef<HTMLTextAreaElement>(null)
  const submitRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [reason, setReason] =
    useState<CreateQuestionReportRequest['reason']>('OTHER')
  const [description, setDescription] = useState('')
  const [announcement, setAnnouncement] = useState('')
  const mutation = useCreatePhase7QuestionReport(() => {
    setOpen(false)
    setDescription('')
    setAnnouncement('문제 신고를 접수했습니다.')
  })

  const errorMessage = mutation.error
    ? isPhase7UiApiError(mutation.error)
      ? mutation.error.code === 'QUESTION_REPORT_DUPLICATE'
        ? '같은 문제 버전에 처리 중인 신고가 이미 있습니다.'
        : mutation.error.code === 'RATE_LIMITED'
          ? `신고 요청이 너무 많습니다.${mutation.error.retryAfterMs ? ` ${Math.ceil(mutation.error.retryAfterMs / 1000)}초 뒤 다시 시도해 주세요.` : ''}`
          : mutation.error.isOffline
            ? '오프라인입니다. 작성한 설명은 유지됩니다.'
            : (mutation.error.serverMessage ?? mutation.error.message)
      : '문제 신고를 접수하지 못했습니다.'
    : null
  const fieldErrors =
    mutation.error && isPhase7UiApiError(mutation.error)
      ? mutation.error.fieldErrors
      : undefined

  useEffect(() => {
    if (!mutation.error) return
    if (fieldErrors?.reason?.length) reasonRef.current?.focus()
    else if (fieldErrors?.description?.length) descriptionRef.current?.focus()
    else submitRef.current?.focus()
  }, [fieldErrors, mutation.error])

  return (
    <>
      <Button
        ref={triggerRef}
        size="sm"
        variant="outline"
        onClick={() => {
          mutation.reset()
          setOpen(true)
        }}
      >
        문제 신고
      </Button>
      <Dialog
        initialFocusRef={descriptionRef}
        open={open}
        preventClose={mutation.isPending}
        returnFocusRef={triggerRef}
        title="문제 신고"
        description="신고 내용은 관리자만 확인하며 HTML로 해석하지 않습니다."
        onOpenChange={(nextOpen) => {
          if (!mutation.isPending) setOpen(nextOpen)
        }}
      >
        <form
          className="grid gap-5"
          onSubmit={(event) => {
            event.preventDefault()
            mutation.mutate({
              questionId,
              request: { questionVersionId, reason, description }
            })
          }}
        >
          <Select
            ref={reasonRef}
            error={fieldErrors?.reason?.[0]}
            label="신고 사유"
            name="report-reason"
            value={reason}
            onChange={(event) =>
              setReason(
                event.currentTarget
                  .value as CreateQuestionReportRequest['reason']
              )
            }
          >
            {reasons.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </Select>
          <Textarea
            ref={descriptionRef}
            error={fieldErrors?.description?.[0]}
            label="설명"
            maxLength={2000}
            name="report-description"
            required
            rows={6}
            value={description}
            onChange={(event) => setDescription(event.currentTarget.value)}
          />
          {errorMessage && !fieldErrors?.description?.length ? (
            <p className="font-semibold text-red-700" role="alert">
              {errorMessage}
            </p>
          ) : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              disabled={mutation.isPending}
              variant="outline"
              onClick={() => setOpen(false)}
            >
              취소
            </Button>
            <Button
              ref={submitRef}
              disabled={description.trim().length === 0}
              isLoading={mutation.isPending}
              type="submit"
            >
              신고 접수
            </Button>
          </div>
        </form>
      </Dialog>
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </>
  )
}
