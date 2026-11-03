import { Link, useLocation } from 'react-router'
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'
import type { ReactElement } from 'react'

const importPath = '/questions/import'

const isCurrent = (pathname: string, to: string): boolean =>
  to === '/questions'
    ? (pathname === to || pathname.startsWith(`${to}/`)) &&
      !pathname.startsWith(importPath)
    : pathname === to || pathname.startsWith(`${to}/`)

export const AdminNavigation = (): ReactElement => {
  const { t } = useAdminPresentation()
  const { pathname } = useLocation()
  return (
    <nav aria-label={t('common.menuLabel')}>
      <ul className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
        {[
          { to: '/questions', label: t('common.questions') },
          { to: importPath, label: t('common.import') },
          { to: '/reports', label: t('common.reports') },
          { to: '/audit-log', label: t('common.auditLog') }
        ].map(({ to, label }) => {
          const current = isCurrent(pathname, to)
          return (
            <li key={to} className="shrink-0">
              <Link
                to={to}
                aria-current={current ? 'page' : undefined}
                className={`flex min-h-11 items-center whitespace-nowrap rounded-sm px-3 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${current ? 'bg-brand-soft text-brand' : 'text-muted hover:text-brand'}`}
              >
                {label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
