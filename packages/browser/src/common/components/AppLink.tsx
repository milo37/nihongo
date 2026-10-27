import { Link, useHref } from 'react-router'
import type { LinkProps } from 'react-router'
import type { ReactElement } from 'react'
import { resolveAppDestination } from '../../libs/appNavigation'

export const AppLink = ({
  to,
  reloadDocument,
  ...props
}: LinkProps): ReactElement => {
  const basename = useHref('/')
  if (typeof to !== 'string')
    return <Link {...props} to={to} reloadDocument={reloadDocument} />
  const destination = resolveAppDestination(to, basename)
  return (
    <Link
      {...props}
      to={
        destination.crossApplication
          ? new URL(to, window.location.origin).href
          : destination.path
      }
      reloadDocument={destination.crossApplication || reloadDocument}
    />
  )
}
