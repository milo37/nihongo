import { lazy } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { ReactElement } from 'react'
import type { RouteObject } from 'react-router'
import type {
  OperationsInformationLinkProps,
  OperationsInformationPageKind
} from '@app/operations/page'

const OperationsInformationPage = lazy(() =>
  import('@app/operations/page').then((module) => ({
    default: module.OperationsInformationPage
  }))
)

type OperationsRouteProps = {
  readonly page: OperationsInformationPageKind
}

const OperationsInformationLink = ({
  children,
  className,
  href
}: OperationsInformationLinkProps): ReactElement => (
  <Link className={className} to={href}>
    {children}
  </Link>
)

const OperationsRoute = ({ page }: OperationsRouteProps): ReactElement => {
  const { t } = useTranslation('operations')

  return (
    <OperationsInformationPage
      LinkComponent={OperationsInformationLink}
      page={page}
      translate={t}
    />
  )
}

export const operationsRoutes: RouteObject[] = [
  {
    path: 'legal',
    element: <OperationsRoute page="legal" />
  },
  {
    path: 'account/data',
    element: <OperationsRoute page="account" />
  },
  {
    path: 'support',
    element: <OperationsRoute page="support" />
  }
]
