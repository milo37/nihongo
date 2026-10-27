import { Link } from 'react-router'
import type { TFunction } from 'i18next'
import type { ReactElement } from 'react'
import { operationsNavigationLinks } from '@app/operations/operationsContent'
import type { OperationsInformationPageKind } from '@app/operations/operationsContent'

type OperationsNavigationProps = {
  page: OperationsInformationPageKind
  translate: TFunction<'operations'>
}

export const OperationsNavigation = ({
  page,
  translate
}: OperationsNavigationProps): ReactElement => (
  <nav
    className="operations-navigation"
    aria-label={translate('navigation.label')}
  >
    <ul>
      {operationsNavigationLinks.map(({ to, key }) => (
        <li key={key}>
          <Link to={to} aria-current={page === key ? 'page' : undefined}>
            {translate(`navigation.${key}`)}
          </Link>
        </li>
      ))}
    </ul>
  </nav>
)
