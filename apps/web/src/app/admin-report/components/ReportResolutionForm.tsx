import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { FormEvent, ReactElement } from 'react'
import {
  resolveAdminQuestionReportRequestSchema,
  type ResolveAdminQuestionReportRequest
} from '@nihongo/contracts/admin/phase7'
import { adminReportOutcomeKey } from '@app/admin/presentation/adminPresentation'
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'
import { Button } from '@common/components/Button'
import { Input } from '@common/components/Input'
import { Select } from '@common/components/Select'
import { Textarea } from '@common/components/Textarea'
export interface ReportResolutionDraft {
  readonly outcome: 'RESOLVED' | 'DISMISSED'
  readonly reason: string
  readonly remediationVersionId: string
}
export const emptyReportResolution: ReportResolutionDraft = {
  outcome: 'RESOLVED',
  reason: '',
  remediationVersionId: ''
}
type ReportResolutionFormProps = {
  readonly draft: ReportResolutionDraft
  readonly rowVersion: number
  readonly locked: boolean
  readonly pending: boolean
  readonly serverFieldErrors?: Record<string, string[]>
  readonly onChange: (draft: ReportResolutionDraft) => void
  readonly onSubmit: (request: ResolveAdminQuestionReportRequest) => void
}
export const ReportResolutionForm = ({
  draft,
  rowVersion,
  locked,
  pending,
  serverFieldErrors,
  onChange,
  onSubmit
}: ReportResolutionFormProps): ReactElement => {
  const { t, presentFieldError } = useAdminPresentation()
  const { t: labels } = useTranslation('adminReports')
  const [attempted, setAttempted] = useState(false)
  const outcomeRef = useRef<HTMLSelectElement>(null)
  const reasonRef = useRef<HTMLTextAreaElement>(null)
  const remediationRef = useRef<HTMLInputElement>(null)
  const parsed = resolveAdminQuestionReportRequestSchema.safeParse({
    expectedRowVersion: rowVersion,
    outcome: draft.outcome,
    reason: draft.reason,
    remediationVersionId:
      draft.outcome === 'RESOLVED' && draft.remediationVersionId.trim()
        ? draft.remediationVersionId.trim()
        : null
  })
  useEffect(() => {
    if (serverFieldErrors?.outcome?.length) outcomeRef.current?.focus()
    else if (serverFieldErrors?.reason?.length) reasonRef.current?.focus()
    else if (serverFieldErrors?.remediationVersionId?.length)
      remediationRef.current?.focus()
  }, [serverFieldErrors])
  const fieldError = (key: keyof ReportResolutionDraft): string | undefined => {
    if (
      attempted &&
      !parsed.success &&
      parsed.error.issues.some((issue) => issue.path[0] === key)
    )
      return t('errors.fieldInvalid')
    return presentFieldError(serverFieldErrors?.[key])
  }
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (locked || pending) return
    setAttempted(true)
    if (!parsed.success) {
      const path = parsed.error.issues[0]?.path[0]
      if (path === 'outcome') outcomeRef.current?.focus()
      else if (path === 'remediationVersionId') remediationRef.current?.focus()
      else reasonRef.current?.focus()
      return
    }
    onSubmit(parsed.data)
  }
  return (
    <form
      className="admin-report-panel admin-report-resolution"
      onSubmit={submit}
      noValidate
    >
      <h2>{t('reportDetail.resolutionTitle')}</h2>
      <Select
        ref={outcomeRef}
        name="outcome"
        label={t('reportDetail.outcome')}
        value={draft.outcome}
        disabled={locked || pending}
        error={fieldError('outcome')}
        options={Object.entries(adminReportOutcomeKey).map(([value, key]) => ({
          value,
          label: t(key)
        }))}
        onChange={(event) =>
          onChange({
            ...draft,
            outcome:
              event.currentTarget.value === 'DISMISSED'
                ? 'DISMISSED'
                : 'RESOLVED',
            remediationVersionId: ''
          })
        }
      />
      <Textarea
        ref={reasonRef}
        name="resolutionReason"
        label={t('reportDetail.resolutionReason')}
        required
        value={draft.reason}
        hint={labels('reasonHint')}
        error={fieldError('reason')}
        disabled={locked || pending}
        onChange={(event) =>
          onChange({ ...draft, reason: event.currentTarget.value })
        }
      />
      {draft.outcome === 'RESOLVED' ? (
        <Input
          ref={remediationRef}
          name="remediationVersionId"
          label={t('reportDetail.remediationVersionId')}
          value={draft.remediationVersionId}
          hint={t('reportDetail.remediationHint')}
          error={fieldError('remediationVersionId')}
          disabled={locked || pending}
          onChange={(event) =>
            onChange({
              ...draft,
              remediationVersionId: event.currentTarget.value
            })
          }
        />
      ) : null}
      <div>
        <Button
          type="submit"
          disabled={locked}
          isLoading={pending}
          loadingLabel={t('editor.saving')}
        >
          {t('reportDetail.resolve')}
        </Button>
      </div>
    </form>
  )
}
