import { createContext, useContext } from 'react'
import { Navigate, Outlet, useLocation, type Location } from 'react-router'
import type { ReactElement, ReactNode } from 'react'
import type { AuthenticatedUser } from '@nihongo/contracts/auth/get-current-principal'
import { ErrorState } from '@common/components/ErrorState'
import type { UserRole } from '@common/types/domain'
import { LoadingState } from '@common/components/LoadingState'
import { useAuthSynchronization } from '@app/login/hooks/useAuthSynchronization'

interface AuthContextValue {
  user: AuthenticatedUser | null
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
  const { canonicalUser, hasError, isReady, retry } = useAuthSynchronization()
  const user = isReady ? (canonicalUser ?? null) : null
  const role: UserRole = user?.role ?? 'GUEST'

  if (hasError) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-16 sm:px-6">
        <ErrorState
          autoFocus
          description="서버에서 로그인 상태를 확인하지 못했습니다. 저장된 계정 정보는 권한 판단에 사용하지 않았습니다."
          headingLevel={1}
          onRetry={retry}
          title="로그인 상태를 확인할 수 없습니다"
        />
      </main>
    )
  }

  return (
    <AuthContext.Provider value={{ user, role, isReady }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = (): AuthContextValue => {
  const context = useContext(AuthContext)

  if (!context) {
    throw new Error('useAuth must be used inside ProtectedRouteProvider')
  }

  return context
}

export const RequireRole = ({
  allowedRoles
}: RequireRoleProps): ReactElement => {
  const { isReady, role } = useAuth()
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
