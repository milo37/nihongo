import { Button } from '@nihongo/browser/common/components/Button'
import { Dialog } from '@nihongo/browser/common/components/Dialog'
import { Select } from '@nihongo/browser/common/components/Select'
import { LEVELS, SUBJECTS } from '@nihongo/browser/common/types/domain'
import type {
  JlptLevel,
  QuestionSubject
} from '@nihongo/browser/common/types/domain'
import { formatNumber } from '@nihongo/browser/libs/localeFormatters'
import { useUiLocale } from '@nihongo/browser/provider/I18nProvider'
import { useEffect, useRef } from 'react'
import type { ReactElement, RefObject } from 'react'
import {
  ReauthDialogButton,
  ReauthRequiredNotice
} from '@app/admin/reauth/ReauthRequiredNotice'
import { useAdminReauth } from '@app/admin/reauth/useAdminReauth'
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'
import { questionErrorCode } from '@app/admin-question/detail/questionWorkflow'
import type { QuestionRetire } from '@app/admin-question/hooks/useQuestionRetire'

/** Pick a level and subject, see the count, confirm (JLP-817). */
export const RetireByGroupDialog = ({
  retire,
  fallbackFocusRef
}: {
  readonly retire: QuestionRetire
  readonly fallbackFocusRef: RefObject<HTMLElement | null>
}): ReactElement => {
  const { t, presentError } = useAdminPresentation()
  const { locale } = useUiLocale()
  const reauth = useAdminReauth()
  const { group, targets, mutation } = retire
  const total = targets.data?.length ?? 0
  const count = formatNumber(total, locale)
  const confirmLabel = t('questionList.retire.confirm', { count })
  const code = questionErrorCode(mutation.error)
  const needsReauth = code === 'FRESH_ASSURANCE_REQUIRED'
  const showError = mutation.isError && !needsReauth
  const errorAlert = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    if (showError) errorAlert.current?.focus()
  }, [showError])
  const groupText = group
    ? {
        level: group.level,
        subject: t(`enums.subjects.${group.subject}`)
      }
    : null
  const ready = Boolean(group && targets.isSuccess && total > 0)

  return (
    <Dialog
      open={retire.open}
      title={t('questionList.retire.title')}
      description={t('questionList.retire.description')}
      preventClose={mutation.isPending}
      fallbackFocusRef={fallbackFocusRef}
      onOpenChange={(open) => {
        if (!open) retire.close()
      }}
      footer={
        <>
          <Button
            variant="secondary"
            disabled={mutation.isPending}
            onClick={retire.close}
          >
            {t('questionList.batch.dialog.cancel')}
          </Button>
          {needsReauth ? (
            <ReauthDialogButton reauth={reauth} keep={retire.keep} />
          ) : (
            /* aria-disabled, not disabled: focus stays on the button while sending. */
            <Button
              variant="danger"
              className="aria-disabled:cursor-wait aria-disabled:opacity-70"
              aria-disabled={mutation.isPending || undefined}
              aria-busy={mutation.isPending || undefined}
              disabled={!ready}
              onClick={() => {
                if (!mutation.isPending) retire.confirm()
              }}
            >
              {mutation.isPending
                ? t('questionList.retire.confirming')
                : confirmLabel}
            </Button>
          )}
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          name="retire-level"
          label={t('questionList.columns.level')}
          placeholder={t('questionList.retire.choose')}
          value={retire.level}
          disabled={mutation.isPending}
          onChange={(event) =>
            retire.setLevel(event.currentTarget.value as JlptLevel | '')
          }
          options={LEVELS.map((value) => ({ value, label: value }))}
        />
        <Select
          name="retire-subject"
          label={t('questionList.columns.subject')}
          placeholder={t('questionList.retire.choose')}
          value={retire.subject}
          disabled={mutation.isPending}
          onChange={(event) =>
            retire.setSubject(event.currentTarget.value as QuestionSubject | '')
          }
          options={SUBJECTS.map((value) => ({
            value,
            label: t(`enums.subjects.${value}`)
          }))}
        />
      </div>
      <div role="status" className="mt-4 font-semibold leading-7">
        {!groupText ? (
          <span className="font-normal text-muted">
            {t('questionList.retire.pick')}
          </span>
        ) : targets.isPending ? (
          <span className="font-normal text-muted">
            {t('questionList.retire.counting')}
          </span>
        ) : targets.isError ? null : total === 0 ? (
          t('questionList.retire.none', groupText)
        ) : (
          t('questionList.retire.count', { ...groupText, count })
        )}
      </div>
      {groupText && targets.isError ? (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <p role="alert" className="text-sm font-semibold text-red-700">
            {t('questionList.retire.countFailed')}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void targets.refetch()}
          >
            {t('questionList.retire.retry')}
          </Button>
        </div>
      ) : null}
      <p className="mt-3 text-sm leading-6 text-muted">
        {t('questionList.retire.body')}
      </p>
      {needsReauth ? (
        <ReauthRequiredNotice
          command={confirmLabel}
          keeps="input"
          reauth={reauth}
        />
      ) : showError ? (
        <p
          ref={errorAlert}
          tabIndex={-1}
          className="mt-4 rounded-sm text-sm font-semibold text-red-700"
          role="alert"
        >
          {presentError(mutation.error)} {t('questionList.retire.notDone')}
        </p>
      ) : null}
    </Dialog>
  )
}

/** What the last group retirement did, above the list until closed. */
export const RetireByGroupResult = ({
  retire,
  headingRef
}: {
  readonly retire: QuestionRetire
  readonly headingRef: RefObject<HTMLHeadingElement | null>
}): ReactElement | null => {
  const { t, presentError } = useAdminPresentation()
  const { locale } = useUiLocale()
  const { result } = retire
  // After the dialog hands focus back to its opener, move it to the outcome.
  useEffect(() => {
    if (!result) return
    const frame = window.requestAnimationFrame(() =>
      headingRef.current?.focus()
    )
    return () => window.cancelAnimationFrame(frame)
  }, [result, headingRef])
  if (!result) return null
  const count = formatNumber(result.retired, locale)
  return (
    <section className="mt-8 rounded-2xl border border-line bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="rounded-sm text-lg font-bold"
        >
          {result.stopCode === null
            ? t('questionList.retire.all', {
                level: result.level,
                subject: t(`enums.subjects.${result.subject}`),
                count
              })
            : t('questionList.retire.partial', {
                count,
                rest: formatNumber(result.notDone, locale)
              })}
        </h2>
        <Button variant="secondary" size="sm" onClick={retire.closeResult}>
          {t('questionList.batch.result.close')}
        </Button>
      </div>
      {result.stopCode !== null ? (
        <p className="mt-2 text-sm text-muted">
          {presentError({ code: result.stopCode })}
        </p>
      ) : null}
    </section>
  )
}
