import { createContext, useContext } from 'react'
import { Navigate, Outlet, useLocation, type Location } from 'react-router'
import type { ReactElement, ReactNode } from 'react'
import type { User, UserRole } from '@common/types/domain'
import { LoadingState } from '@common/components/LoadingState'
import { useAuthSynchronization } from '@app/login/hooks/useAuthSynchronization'
import { useAppStore } from '@store/index'

interface AuthContextValue {
  user: User | null
  role: UserRole
  isReady: boolean
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
  const projectedUser = useAppStore((state) => state.currentUser)
  const { canonicalUser, isReady } = useAuthSynchronization()
  const user = isReady
    ? canonicalUser !== undefined
      ? canonicalUser
      : projectedUser
    : null
  const role: UserRole = user?.role ?? 'GUEST'

  return (
    <AuthContext.Provider value={{ user, role, isReady }}>
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
  const { isReady, role } = useDemoAuth()
  const location = useLocation()

  if (!isReady) {
    return <LoadingState message="로그인 상태를 확인하고 있습니다…" />
  }

  if (allowedRoles.includes(role)) {
    return <Outlet />
  }

  if (role === 'GUEST') {
    const redirect = encodeURIComponent(getRedirectPath(location))
    return <Navigate replace to={`/login?redirect=${redirect}`} />
  }

  return <Navigate replace to="/forbidden" />
}
