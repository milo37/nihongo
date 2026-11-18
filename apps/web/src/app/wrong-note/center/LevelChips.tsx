import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import { jlptLevelSchema } from '@nihongo/contracts/common/enum'
import type { JlptLevel } from '@nihongo/contracts/common/enum'

type LevelChipsProps = {
  onSelect: (level: JlptLevel | undefined) => void
  selected: JlptLevel | undefined
}

/** 'All' and N5–N1 chips; the picked one is pressed. */
export const LevelChips = ({
  onSelect,
  selected
}: LevelChipsProps): ReactElement => {
  // Left uncompiled: the compiled parent already caches this section, and
  // compiling it too adds about 200 bytes gzip (#1124 bundle).
  'use no memo'
  const { t } = useTranslation('wrongNote')
  return (
    <div
      role="group"
      aria-label={t('levelLabel')}
      className="mt-4 flex flex-wrap gap-2"
    >
      {[undefined, ...jlptLevelSchema.options].map((level) => {
        const isSelected = selected === level
        return (
          <button
            key={level ?? 'all'}
            type="button"
            aria-pressed={isSelected}
            className={`relative min-h-9 rounded-full border px-3 text-sm before:absolute before:-inset-1 before:content-[''] focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ${
              isSelected
                ? 'border-brand-strong bg-brand-soft font-bold text-ink shadow-none'
                : 'border-line bg-surface font-semibold text-muted'
            }`}
            onClick={() => onSelect(level)}
          >
            {level ?? t('levelAll')}
          </button>
        )
      })}
    </div>
  )
}
