import { Outlet } from 'react-router'
import { AdminNavigation } from '@app/admin/components/AdminNavigation'
import { IdleLockDialog } from '@app/admin/idle-lock/IdleLockDialog'
import { ReauthReturnNotice } from '@nihongo/browser/app/reauth/components/ReauthReturnNotice'
import type { ReactElement } from 'react'

export const AdminShell = (): ReactElement => (
  <div className="lg:grid lg:grid-cols-[232px_minmax(0,1fr)]">
    <aside className="border-b border-line px-4 py-2 sm:px-6 lg:border-b-0 lg:border-r lg:px-3 lg:py-10">
      <AdminNavigation />
    </aside>
    <div className="min-w-0">
      <Outlet />
    </div>
    <IdleLockDialog />
    <ReauthReturnNotice />
  </div>
)
