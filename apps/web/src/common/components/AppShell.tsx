import type { ComponentPropsWithRef, ReactElement, ReactNode } from 'react'
import { classNames } from '@common/components/classNames'

type AppShellProps = {
  children: ReactNode
  sidebar?: ReactNode
  header?: ReactNode
  footer?: ReactNode
  bottomNavigation?: ReactNode
  beforeMain?: ReactNode
  mainProps?: ComponentPropsWithRef<'main'>
  className?: string
  surface?: string
}

export const AppShell = ({
  children,
  sidebar,
  header,
  footer,
  bottomNavigation,
  beforeMain,
  mainProps,
  className,
  surface
}: AppShellProps): ReactElement => (
  <div
    className={classNames('app-shell bg-canvas text-ink', className)}
    data-surface={surface}
  >
    {beforeMain}
    {sidebar}
    <div className="app-shell-body">
      {header}
      <main {...mainProps}>{children}</main>
      {footer}
    </div>
    {bottomNavigation}
  </div>
)
