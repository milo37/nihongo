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

type InformationFooterProps = {
  density?: 'regular' | 'compact'
}

export const InformationFooter = ({
  density = 'regular'
}: InformationFooterProps): ReactElement => {
  const { t } = useTranslation('common')
  const compact = density === 'compact'
  const groups = compact
    ? [informationGroups[0], informationGroups[2], informationGroups[1]]
    : informationGroups
  const groupLabels = ['guidance', 'help', 'account'] as const
  return (
    <footer
      className={`information-footer${compact ? ' information-footer-compact' : ''}`}
    >
      <div className="information-footer-inner">
        <div className="information-footer-about">
          <p className="information-footer-brand">JLPT Drill Note</p>
          <p className="information-footer-description">
            {t('footer.originalContent')}
            {compact ? ' ' : <br />}
            {t('footer.scope')}
          </p>
        </div>
        <nav aria-label={t('footer.informationLabel')}>
          {groups.map((group, index) => (
            <ul className="information-footer-group" key={group[0].key}>
              {compact ? (
                <li className="information-footer-group-label">
                  {t(`footer.groups.${groupLabels[index]}`)}
                </li>
              ) : null}
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
