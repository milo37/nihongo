import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { ReactElement } from 'react'

const informationLinks = [
  { to: '/legal', key: 'guidance' },
  { to: '/support', key: 'help' },
  { to: '/account/data', key: 'account' }
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
