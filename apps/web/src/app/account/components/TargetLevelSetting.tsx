import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ChangeEvent, ReactElement } from 'react'
import type { JlptLevel } from '@nihongo/browser/common/types/domain'
import { LEVELS } from '@nihongo/browser/common/types/domain'
import { Button } from '@nihongo/browser/common/components/Button'
import { Select } from '@nihongo/browser/common/components/Select'
import { useToast } from '@nihongo/browser/common/components/Toast'
import { useUpdateTargetLevel } from '@app/account/hooks/useUpdateTargetLevel'

type TargetLevelSettingProps = {
  targetLevel: JlptLevel | null
}

const isJlptLevel = (value: string): value is JlptLevel =>
  (LEVELS as readonly string[]).includes(value)

// The saved message stays long enough to read (JLP-861: at least 5s).
const SAVED_TOAST_MS = 6000

// One row (subtract table line 2): practice starts from this level.
// JLP-861: picking only changes the screen; [Save] sends the one PATCH. A
// pick that is never saved is dropped when the screen goes away.
export const TargetLevelSetting = ({
  targetLevel
}: TargetLevelSettingProps): ReactElement => {
  const { t } = useTranslation('account')
  const update = useUpdateTargetLevel()
  const { addToast } = useToast()
  const headingId = useId()
  const [picked, setPicked] = useState<JlptLevel | null>(null)
  const value = picked ?? targetLevel
  const handleChange = (event: ChangeEvent<HTMLSelectElement>): void => {
    const { value: next } = event.target
    if (!isJlptLevel(next)) return
    setPicked(next)
    if (update.isError) update.reset()
  }
  const handleSave = (): void => {
    if (value === null || value === targetLevel) return
    update.mutate(
      { targetLevel: value },
      {
        onSuccess: () => {
          addToast({
            key: 'targetLevel',
            title: t('targetLevel.saved', { level: value }),
            variant: 'success',
            durationMs: SAVED_TOAST_MS
          })
        }
      }
    )
  }
  return (
    // JLP-851: right under the name, a small name tag over the select; no
    // heading or card. The select keeps its own (hidden) label.
    <section className="grid gap-1.5" aria-labelledby={headingId}>
      <p id={headingId} className="text-[13px] text-muted">
        {t('targetLevel.label')}
      </p>
      <div className="flex items-start gap-2 sm:max-w-96">
        <div className="min-w-0 flex-1">
          <Select
            name="targetLevel"
            hideLabel
            label={t('targetLevel.label')}
            hint={t('targetLevel.hint')}
            placeholder={t('targetLevel.unset')}
            value={value ?? ''}
            disabled={update.isPending}
            aria-busy={update.isPending || undefined}
            error={update.isError ? t('targetLevel.error') : undefined}
            options={LEVELS.map((level) => ({ value: level, label: level }))}
            onChange={handleChange}
          />
        </div>
        <Button
          className="shrink-0"
          variant="outline"
          disabled={value === null || value === targetLevel}
          isLoading={update.isPending}
          loadingLabel={t('targetLevel.saveAction')}
          onClick={handleSave}
        >
          {t('targetLevel.saveAction')}
        </Button>
      </div>
    </section>
  )
}
