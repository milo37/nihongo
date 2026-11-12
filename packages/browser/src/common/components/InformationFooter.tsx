import { useTranslation } from 'react-i18next'
import { AppLink as Link } from './AppLink'
import type { ReactElement } from 'react'

// JLP-850: same names and order as the top tabs of the three pages.
const informationLinks = [
  { to: '/legal', key: 'guidance' },
  { to: '/account/data', key: 'account' },
  { to: '/support', key: 'help' }
] as const

type InformationFooterProps = {
  density?: 'regular' | 'compact'
}

export const InformationFooter = ({
  density = 'regular'
}: InformationFooterProps): ReactElement => {
  const { t } = useTranslation('common')
  return (
    <footer className="information-footer" data-density={density}>
      <div className="information-footer-inner">
        <nav aria-label={t('footer.informationLabel')}>
          <ul className="information-footer-links">
            {informationLinks.map(({ to, key }) => (
              <li key={key}>
                <Link to={to}>{t(`footer.groups.${key}`)}</Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </footer>
  )
}
