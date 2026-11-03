import { Link, useLocation } from 'react-router'
import { Icon } from '@nihongo/browser/common/components/Icon'
import type { IconName } from '@nihongo/browser/common/components/Icon'
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'
import type { ReactElement } from 'react'

const importPath = '/questions/import'

const isCurrent = (pathname: string, to: string): boolean =>
  to === '/questions'
    ? (pathname === to || pathname.startsWith(`${to}/`)) &&
      !pathname.startsWith(importPath)
    : pathname === to || pathname.startsWith(`${to}/`)

const items: readonly { to: string; key: string; icon: IconName }[] = [
  { to: '/questions', key: 'nav.questions', icon: 'book-open' },
  { to: importPath, key: 'nav.import', icon: 'upload' },
  { to: '/members', key: 'nav.members', icon: 'user-round' },
  { to: '/reports', key: 'nav.reports', icon: 'circle-alert' },
  { to: '/audit-log', key: 'nav.auditLog', icon: 'history' }
]

export const AdminNavigation = (): ReactElement => {
  const { t } = useAdminPresentation()
  const { pathname } = useLocation()
  return (
    <nav aria-label={t('common.menuLabel')}>
      <p className="mb-2 px-3 text-sm font-black lg:mb-4 lg:text-base">
        {t('nav.brand')}
      </p>
      <ul className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
        {items.map(({ to, key, icon }) => {
          const current = isCurrent(pathname, to)
          return (
            <li key={to} className="shrink-0">
              <Link
                to={to}
                aria-current={current ? 'page' : undefined}
                className={`flex min-h-11 items-center gap-2 whitespace-nowrap rounded-sm px-3 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${current ? 'bg-brand-soft text-brand' : 'text-muted hover:text-brand'}`}
              >
                <Icon name={icon} className="size-4 shrink-0" />
                {t(key)}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
