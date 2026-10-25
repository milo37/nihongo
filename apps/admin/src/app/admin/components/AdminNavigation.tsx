import { NavLink } from 'react-router'
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'
import type { ReactElement } from 'react'

export const AdminNavigation = (): ReactElement => {
  const { t } = useAdminPresentation()
  return (
    <nav
      className="mb-6 flex flex-wrap gap-3 text-sm"
      aria-label={t('common.breadcrumbLabel')}
    >
      {[
        { to: '/questions', label: t('common.questions') },
        { to: '/audit-log', label: t('common.auditLog') }
      ].map(({ to, label }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            `inline-flex min-h-11 items-center rounded-sm px-2 font-semibold underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${isActive ? 'text-brand' : 'text-muted'}`
          }
        >
          {label}
        </NavLink>
      ))}
    </nav>
  )
}
