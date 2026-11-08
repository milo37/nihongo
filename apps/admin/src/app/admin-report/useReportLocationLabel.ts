import { formatNumber } from '@nihongo/browser/libs/localeFormatters'
import { useUiLocale } from '@nihongo/browser/provider/I18nProvider'
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'

/**
 * Stored locations are `<screen>` or `<screen>#<ordinal>`; show the screen
 * name and question number, and keep anything unknown visible as raw text.
 */
export const useReportLocationLabel = (): ((location: string) => string) => {
  const { t } = useAdminPresentation()
  const { locale } = useUiLocale()
  // The label table is the list of known screens.
  const screens: unknown = t('userReport.location.screens', {
    returnObjects: true
  })
  return (location) => {
    const [, screen = '', ordinal] =
      /^([A-Za-z]+)(?:#([1-9]\d*))?$/u.exec(location) ?? []
    const name =
      typeof screens === 'object' &&
      screens !== null &&
      Object.hasOwn(screens, screen)
        ? (screens as Record<string, string>)[screen]
        : undefined
    if (!name) return t('userReport.location.unknown', { raw: location })
    return ordinal
      ? t('userReport.location.question', {
          screen: name,
          ordinal: formatNumber(Number(ordinal), locale)
        })
      : name
  }
}
