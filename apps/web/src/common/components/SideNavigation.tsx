import { Link } from 'react-router'
import type { ReactElement, ReactNode } from 'react'
import { Icon } from '@common/components/Icon'
import type { IconName } from '@common/components/Icon'

type SideNavigationProps = {
  id: string
  label: string
  brand: ReactNode
  items: readonly {
    to: string
    label: string
    icon: IconName
    active?: boolean
  }[]
  onNavigate?: () => void
}

export const SideNavigation = ({
  id,
  label,
  brand,
  items,
  onNavigate
}: SideNavigationProps): ReactElement => (
  <aside className="app-side-navigation">
    <div className="app-side-brand">{brand}</div>
    <nav id={id} className="app-primary-navigation" aria-label={label}>
      {items.map((item) => (
        <Link
          key={item.to}
          to={item.to}
          className="app-nav-link"
          aria-current={item.active ? 'page' : undefined}
          onClick={onNavigate}
        >
          <Icon className="app-nav-icon" name={item.icon} />
          <span>{item.label}</span>
        </Link>
      ))}
    </nav>
  </aside>
)
