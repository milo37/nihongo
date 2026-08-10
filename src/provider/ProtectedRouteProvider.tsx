import { createContext, useContext } from 'react'
import { Navigate, Outlet, useLocation, type Location } from 'react-router'
import type { ReactElement, ReactNode } from 'react'
import type { User, UserRole } from '@common/types/domain'
import { useAppStore } from '@store/index'

interface AuthContextValue {
  user: User | null
  role: UserRole
}

const AuthContext = createContext<AuthContextValue | null>(null)

type ProtectedRouteProviderProps = {
  children: ReactNode
}

type RequireRoleProps = {
  allowedRoles: UserRole[]
}

const getRedirectPath = (location: Location): string => {
  return `${location.pathname}${location.search}`
}

export const ProtectedRouteProvider = ({
  children
}: ProtectedRouteProviderProps): ReactElement => {
  const user = useAppStore((state) => state.currentUser)
  const role: UserRole = user?.role ?? 'GUEST'

  return (
    <AuthContext.Provider value={{ user, role }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useDemoAuth = (): AuthContextValue => {
  const context = useContext(AuthContext)

  if (!context) {
    throw new Error('useDemoAuth must be used inside ProtectedRouteProvider')
  }

  return context
}

export const RequireRole = ({
  allowedRoles
}: RequireRoleProps): ReactElement => {
  const { role } = useDemoAuth()
  const location = useLocation()

  if (allowedRoles.includes(role)) {
    return <Outlet />
  }

  if (role === 'GUEST') {
    const redirect = encodeURIComponent(getRedirectPath(location))
    return <Navigate replace to={`/login?redirect=${redirect}`} />
  }

  return <Navigate replace to="/forbidden" />
}
