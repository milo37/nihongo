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
      className="wrong-note-levels"
    >
      {[undefined, ...jlptLevelSchema.options].map((level) => {
        const isSelected = selected === level
        return (
          <button
            key={level ?? 'all'}
            type="button"
            aria-pressed={isSelected}
            className={`wrong-note-level${isSelected ? ' is-selected' : ''}`}
            onClick={() => onSelect(level)}
          >
            {level ?? t('levelAll')}
          </button>
        )
      })}
    </div>
  )
}
