import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { ReactElement } from 'react'

const informationGroups = [
  [
    { to: '/legal#terms', key: 'terms' },
    { to: '/legal#privacy', key: 'privacy' },
    { to: '/legal#copyright', key: 'copyright' }
  ],
  [
    { to: '/account/data#deletion', key: 'deletion' },
    { to: '/account/data#data-export', key: 'dataExport' }
  ],
  [
    { to: '/support#question-report', key: 'questionReport' },
    { to: '/support#contact', key: 'contact' }
  ]
] as const

export const InformationFooter = (): ReactElement => {
  const { t } = useTranslation('common')
  return (
    <footer className="information-footer">
      <div className="information-footer-inner">
        <div>
          <p className="information-footer-brand">JLPT Drill Note</p>
          <p className="information-footer-description">
            {t('footer.originalContent')}
            <br />
            {t('footer.scope')}
          </p>
        </div>
        <nav aria-label={t('footer.informationLabel')}>
          {informationGroups.map((group) => (
            <ul className="information-footer-group" key={group[0].key}>
              {group.map(({ to, key }) => (
                <li key={key}>
                  <Link to={to}>{t(`footer.${key}`)}</Link>
                </li>
              ))}
            </ul>
          ))}
        </nav>
      </div>
    </footer>
  )
}
