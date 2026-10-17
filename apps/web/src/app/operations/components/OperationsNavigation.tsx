import { Link } from 'react-router'
import type { TFunction } from 'i18next'
import type { ReactElement } from 'react'
import {
  operationsPageKinds,
  operationsPages
} from '@app/operations/operationsContent'
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
      {operationsPageKinds.map((destination) => (
        <li key={destination}>
          <Link
            to={operationsPages[destination].path}
            aria-current={page === destination ? 'page' : undefined}
          >
            {translate(`navigation.${destination}`)}
          </Link>
        </li>
      ))}
    </ul>
  </nav>
)
