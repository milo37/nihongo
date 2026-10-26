import { AppRedirect } from '../common/components/AppRedirect'
import { getAppPath } from '../libs/appNavigation'
import { createContext, useContext, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Outlet, useHref, useLocation, type Location } from 'react-router'
import type { ReactElement, ReactNode } from 'react'
import type { AuthenticatedUser } from '@nihongo/contracts/auth/get-current-principal'
import { ErrorState } from '../common/components/ErrorState'
import type { UserRole } from '../common/types/domain'
import { LoadingState } from '../common/components/LoadingState'
import { useAuthSynchronization } from '../app/login/hooks/useAuthSynchronization'

interface AuthContextValue {
  user: AuthenticatedUser | null
  role: UserRole
  isReady: boolean
}

const AuthContext = createContext<AuthContextValue | null>(null)

type ProtectedRouteProviderProps = {
  children: ReactNode
  renderAuthError?: (content: ReactNode) => ReactNode
}

type RequireRoleProps = {
  allowedRoles: UserRole[]
}

const getRedirectPath = (location: Location): string => {
  return `${location.pathname}${location.search}`
}

export const ProtectedRouteProvider = ({
  children,
  renderAuthError
}: ProtectedRouteProviderProps): ReactElement => {
  const { t } = useTranslation('errors')
  const { canonicalUser, hasError, isOffline, isReady, retry } =
    useAuthSynchronization()
  const shouldRestoreRetryFocusRef = useRef(false)
  const user = isReady ? (canonicalUser ?? null) : null
  const role: UserRole = user?.role ?? 'GUEST'

  useEffect(() => {
    if (!hasError && isReady && shouldRestoreRetryFocusRef.current) {
      shouldRestoreRetryFocusRef.current = false
      document.querySelector<HTMLElement>('#main-content')?.focus()
    }
  }, [hasError, isReady])

  const handleRetry = (): void => {
    shouldRestoreRetryFocusRef.current = true
    retry()
  }

  if (hasError || isOffline) {
    const errorContent = (
      <div className="auth-page">
        <div className="auth-panel auth-standalone-panel">
          <ErrorState
            className="auth-link-error"
            autoFocus
            description={t(
              isOffline
                ? 'authStatus.offlineDescription'
                : 'authStatus.description'
            )}
            headingLevel={1}
            onRetry={handleRetry}
            title={t(
              isOffline ? 'authStatus.offlineTitle' : 'authStatus.title'
            )}
          />
        </div>
      </div>
    )
    return (
      <AuthContext.Provider value={{ user, role, isReady }}>
        {renderAuthError ? (
          renderAuthError(errorContent)
        ) : (
          <main className="mx-auto w-full max-w-3xl px-4 py-16 sm:px-6">
            {errorContent}
          </main>
        )}
      </AuthContext.Provider>
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
  const { t } = useTranslation('common')
  const { isReady, role } = useAuth()
  const location = useLocation()
  const basename = useHref('/')

  if (!isReady) {
    return <LoadingState message={t('loading.auth')} />
  }

  if (allowedRoles.includes(role)) {
    return <Outlet />
  }

  if (role === 'GUEST') {
    const redirect = encodeURIComponent(
      getAppPath(getRedirectPath(location), basename)
    )
    return <AppRedirect to={`/login?redirect=${redirect}`} />
  }

  return <AppRedirect to="/forbidden" />
}
