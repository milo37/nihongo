import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import type { ReactElement, ReactNode, RefObject } from 'react'
import { userMemoMaximumCodePoints } from '@nihongo/contracts/wrong-note/user-memo'
import { Button } from '@nihongo/browser/common/components/Button'
import { classNames } from '@nihongo/browser/common/components/classNames'
import { resolveUiLocale } from '@nihongo/browser/i18n/types'
import { formatNumber } from '@nihongo/browser/libs/localeFormatters'

type WrongNoteMemoEditorProps = {
  draft: string
  hasMemo: boolean
  isPending: boolean
  isSaving: boolean
  isRetry: boolean
  notice: ReactNode
  textareaRef: RefObject<HTMLTextAreaElement | null>
  onDraftChange: (value: string) => void
  onCancel: () => void
  onSave: () => void
}

/** Counts code points of the trimmed draft against the shared memo limit. */
export const measureMemoDraft = (draft: string) => {
  const normalized = draft.trim()
  const length = [...normalized].length
  const excess = length - userMemoMaximumCodePoints
  return { normalized, length, excess, isOver: excess > 0 }
}

export const WrongNoteMemoEditor = ({
  draft,
  hasMemo,
  isPending,
  isSaving,
  isRetry,
  notice,
  textareaRef,
  onDraftChange,
  onCancel,
  onSave
}: WrongNoteMemoEditorProps): ReactElement => {
  const { i18n, t } = useTranslation('wrongNote')
  const locale = resolveUiLocale(i18n.resolvedLanguage)
  const textareaId = useId()
  const countId = useId()
  const { length: draftLength, excess, isOver } = measureMemoDraft(draft)
  const count = (value: number): string => formatNumber(value, locale)

  return (
    <>
      <label className="sr-only" htmlFor={textareaId}>
        {t('memo.label')}
      </label>
      <textarea
        ref={textareaRef}
        id={textareaId}
        name="memo"
        className={classNames(
          'min-h-30 w-full resize-y rounded-control border bg-surface px-3 py-2.5 text-base leading-relaxed text-ink',
          'focus-visible:outline focus-visible:outline-focus focus-visible:outline-offset-focus focus-visible:outline-brand',
          isOver ? 'border-danger' : 'border-line-strong'
        )}
        value={draft}
        aria-invalid={isOver || undefined}
        aria-describedby={countId}
        readOnly={isPending}
        onChange={(event) => onDraftChange(event.target.value)}
      />
      {notice}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <span
          id={countId}
          className={classNames(
            'text-xs tabular-nums',
            isOver ? 'font-bold text-danger' : 'text-muted'
          )}
        >
          {draftLength === 0 && hasMemo
            ? t('memo.clearHint')
            : isOver
              ? t('memo.over', {
                  current: count(draftLength),
                  maximum: count(userMemoMaximumCodePoints),
                  excess: count(excess)
                })
              : t('memo.count', {
                  current: count(draftLength),
                  maximum: count(userMemoMaximumCodePoints)
                })}
        </span>
        <div className="flex w-full gap-2 sm:w-auto">
          <Button
            className="flex-1 sm:flex-none"
            variant="ghost"
            disabled={isPending}
            onClick={onCancel}
          >
            {t('memo.cancel')}
          </Button>
          <Button
            className="flex-1 sm:flex-none"
            disabled={isOver || draftLength === 0}
            isLoading={isSaving}
            loadingLabel={t('memo.saving')}
            onClick={onSave}
          >
            {isRetry ? t('memo.retrySave') : t('memo.save')}
          </Button>
        </div>
      </div>
    </>
  )
}
