import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import type { ChangeEvent, ReactElement } from 'react'
import type { JlptLevel } from '@nihongo/browser/common/types/domain'
import { LEVELS } from '@nihongo/browser/common/types/domain'
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
    // Same heading-over-card rhythm as the study and account sections.
    <section className="grid gap-4" aria-labelledby={headingId}>
      <h2 id={headingId} className="text-xl font-semibold">
        {t('targetLevel.label')}
      </h2>
      <div className="account-card">
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
        <p className="sr-only" role="status">
          {update.isSuccess ? t('targetLevel.saved') : ''}
        </p>
      </div>
    </section>
  )
}
