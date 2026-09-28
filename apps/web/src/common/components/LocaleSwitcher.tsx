import { useTranslation } from 'react-i18next'
import type { ChangeEvent, ReactElement } from 'react'
import { Select } from '@common/components/Select'
import { isUiLocale } from '@/i18n/types'
import { useUiLocale } from '@provider/I18nProvider'

export const LocaleSwitcher = (): ReactElement => {
  const { t } = useTranslation('common')
  const { locale, setLocale } = useUiLocale()
  const options = [
    { value: 'ko', label: t('locale.ko') },
    { value: 'ja', label: t('locale.ja') }
  ] as const

  const handleChange = (event: ChangeEvent<HTMLSelectElement>): void => {
    const nextLocale = event.currentTarget.value
    if (isUiLocale(nextLocale)) {
      setLocale(nextLocale)
    }
  }

  return (
    <Select
      className="min-w-32 py-1 text-sm"
      hideLabel
      label={t('locale.label')}
      name="ui-locale"
      options={options}
      value={locale}
      onChange={handleChange}
    />
  )
}
