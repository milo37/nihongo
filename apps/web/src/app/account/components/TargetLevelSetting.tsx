import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import type { ChangeEvent, ReactElement } from 'react'
import type { JlptLevel } from '@nihongo/browser/common/types/domain'
import { LEVELS } from '@nihongo/browser/common/types/domain'
import { Icon } from '@nihongo/browser/common/components/Icon'
import { Select } from '@nihongo/browser/common/components/Select'
import { useUpdateTargetLevel } from '@app/account/hooks/useUpdateTargetLevel'

type TargetLevelSettingProps = {
  targetLevel: JlptLevel | null
}

const isJlptLevel = (value: string): value is JlptLevel =>
  (LEVELS as readonly string[]).includes(value)

// One row (subtract table line 2): practice starts from this level.
export const TargetLevelSetting = ({
  targetLevel
}: TargetLevelSettingProps): ReactElement => {
  const { t } = useTranslation('account')
  const update = useUpdateTargetLevel()
  const headingId = useId()
  const handleChange = (event: ChangeEvent<HTMLSelectElement>): void => {
    const { value } = event.target
    if (!isJlptLevel(value) || value === targetLevel) return
    update.mutate({ targetLevel: value })
  }
  return (
    // JLP-851: right under the name, a small name tag over the select; no
    // heading or card. The select keeps its own (hidden) label.
    <section className="grid gap-1.5" aria-labelledby={headingId}>
      <p id={headingId} className="text-[13px] text-muted">
        {t('targetLevel.label')}
      </p>
      <div>
        <div className="sm:max-w-80">
          <Select
            name="targetLevel"
            hideLabel
            label={t('targetLevel.label')}
            hint={t('targetLevel.hint')}
            placeholder={t('targetLevel.unset')}
            value={targetLevel ?? ''}
            disabled={update.isPending}
            aria-busy={update.isPending || undefined}
            error={update.isError ? t('targetLevel.error') : undefined}
            options={LEVELS.map((level) => ({ value: level, label: level }))}
            onChange={handleChange}
          />
        </div>
        {/* JLP-848: a visible check line until the next change starts. The
            live region stays mounted so the new text is announced. */}
        <p role="status">
          {update.isSuccess ? (
            <span className="mt-3 flex items-start gap-2 text-sm text-ink">
              <Icon name="check" className="size-5 shrink-0 text-brand" />
              {t('targetLevel.saved', {
                level: update.variables.targetLevel
              })}
            </span>
          ) : null}
        </p>
      </div>
    </section>
  )
}
