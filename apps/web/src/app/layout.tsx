import { Suspense, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { NavLink, Outlet, useLocation, useNavigationType } from 'react-router'
import type { ReactElement } from 'react'
import { LocaleSwitcher } from '@common/components/LocaleSwitcher'
import { LoadingState } from '@common/components/LoadingState'
import { useDocumentMetadata } from '@common/hooks/useDocumentMetadata'
import { getRouteLabelKey } from '@/i18n/routePresentation'
import type { UiLocale } from '@/i18n/types'
import { useUiLocale } from '@provider/I18nProvider'
import { useAuth } from '@provider/ProtectedRouteProvider'
import { useAppStore } from '@store/index'

const getNavClassName = ({ isActive }: { isActive: boolean }): string => {
  return [
    'inline-flex min-h-11 items-center rounded-lg px-3 py-2 text-sm font-semibold transition-colors',
    'focus-visible:outline focus-visible:outline-focus focus-visible:outline-offset-focus focus-visible:outline-brand',
    isActive
      ? 'ui-primary-nav-active bg-brand-soft text-brand underline decoration-2 underline-offset-4'
      : 'text-muted hover:text-ink'
  ].join(' ')
}

const hasPageOwnedFocus = (pathname: string): boolean => {
  return (
    pathname.startsWith('/practice/session/') ||
    pathname.startsWith('/practice/result/')
  )
}

const focusHashTarget = (hash: string): boolean => {
  if (!hash) {
    return false
  }

  let targetId = hash.slice(1)
  try {
    targetId = decodeURIComponent(targetId)
  } catch {
    // 잘못 인코딩된 hash는 원문으로 탐색합니다.
  }

  const target = document.getElementById(targetId)
  if (!target) {
    return false
  }

  if (!target.hasAttribute('tabindex')) {
    target.tabIndex = -1
  }
  target.focus({ preventScroll: true })
  target.scrollIntoView({ block: 'start' })
  return true
}

export const Layout = (): ReactElement => {
  const { t: commonT } = useTranslation('common')
  const { t: navigationT } = useTranslation('navigation')
  const { locale } = useUiLocale()
  const { isReady, role, user } = useAuth()
  const location = useLocation()
  const navigationType = useNavigationType()
  const mainRef = useRef<HTMLElement>(null)
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null)
  const previousPathnameRef = useRef(location.pathname)
  const previousHashRef = useRef('')
  const localeRef = useRef<UiLocale>(locale)
  const [routeAnnouncement, setRouteAnnouncement] = useState<{
    pathname: string
    locale: UiLocale
  } | null>(null)
  const isMobileMenuOpen = useAppStore((state) => state.isMobileMenuOpen)
  const toggleMobileMenu = useAppStore((state) => state.toggleMobileMenu)
  const setMobileMenuOpen = useAppStore((state) => state.setMobileMenuOpen)

  useDocumentMetadata()

  useEffect(() => {
    localeRef.current = locale
  }, [locale])

  useEffect(() => {
    const pathnameChanged = previousPathnameRef.current !== location.pathname
    const hashChanged = previousHashRef.current !== location.hash

    previousPathnameRef.current = location.pathname
    previousHashRef.current = location.hash

    if (!pathnameChanged && !hashChanged) {
      return
    }

    if (pathnameChanged) {
      setRouteAnnouncement(null)
    }

    let hashObserver: MutationObserver | undefined

    const focusMainForPushNavigation = (shouldScroll = true): void => {
      if (
        pathnameChanged &&
        navigationType === 'PUSH' &&
        !hasPageOwnedFocus(location.pathname)
      ) {
        mainRef.current?.focus({ preventScroll: true })
        if (shouldScroll) {
          window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
        }
      }
    }

    const timer = window.setTimeout(() => {
      if (pathnameChanged) {
        setRouteAnnouncement({
          pathname: location.pathname,
          locale: localeRef.current
        })
      }

      if (!location.hash) {
        focusMainForPushNavigation()
        return
      }

      if (focusHashTarget(location.hash)) {
        return
      }

      const observerRoot = mainRef.current
      if (!observerRoot) {
        focusMainForPushNavigation()
        return
      }

      hashObserver = new MutationObserver(() => {
        if (focusHashTarget(location.hash)) {
          hashObserver?.disconnect()
        }
      })
      hashObserver.observe(observerRoot, { childList: true, subtree: true })
      focusMainForPushNavigation(false)
    }, 0)

    return () => {
      window.clearTimeout(timer)
      hashObserver?.disconnect()
    }
  }, [location.hash, location.pathname, navigationType])

  useEffect(() => {
    if (!isMobileMenuOpen) {
      return
    }

    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') {
        return
      }
      event.preventDefault()
      setMobileMenuOpen(false)
      mobileMenuButtonRef.current?.focus()
    }

    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [isMobileMenuOpen, setMobileMenuOpen])

  const closeMenu = (): void => {
    setMobileMenuOpen(false)
  }

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <a
        className="sr-only z-skip-link rounded-lg bg-surface px-4 py-3 font-semibold focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:inline-flex focus:min-h-11 focus:min-w-11 focus:items-center"
        href="#main-content"
      >
        {navigationT('skipToContent')}
      </a>
      <header className="sticky top-0 z-header border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex min-h-16 max-w-content items-center justify-between gap-4 px-4 sm:px-6">
          <NavLink
            className="flex min-h-11 items-center gap-3 rounded-lg focus-visible:outline focus-visible:outline-focus focus-visible:outline-offset-focus focus-visible:outline-brand"
            to="/"
            onClick={closeMenu}
          >
            <span
              className="grid size-10 place-items-center rounded-xl bg-brand-strong font-black text-on-accent"
              aria-hidden="true"
            >
              文
            </span>
            <span className="leading-tight">
              <strong className="block text-base">JLPT Drill Note</strong>
              <span className="block text-xs text-muted">
                {commonT('tagline')}
              </span>
            </span>
          </NavLink>

          <button
            ref={mobileMenuButtonRef}
            className="grid min-h-11 min-w-11 place-items-center rounded-lg border border-line text-xl hover:border-line-strong hover:bg-surface-muted md:hidden"
            type="button"
            aria-label={
              isMobileMenuOpen
                ? navigationT('menuClose')
                : navigationT('menuOpen')
            }
            aria-expanded={isMobileMenuOpen}
            aria-controls="primary-navigation"
            onClick={toggleMobileMenu}
          >
            <span aria-hidden="true">{isMobileMenuOpen ? '×' : '≡'}</span>
          </button>

          <nav
            id="primary-navigation"
            className={[
              'absolute inset-x-0 top-16 border-b border-line bg-surface p-4 md:static md:block md:border-0 md:p-0',
              isMobileMenuOpen ? 'block' : 'hidden md:block'
            ].join(' ')}
            aria-label={navigationT('primary')}
            onBlur={(event) => {
              if (
                isMobileMenuOpen &&
                !event.currentTarget.contains(event.relatedTarget)
              ) {
                setMobileMenuOpen(false)
              }
            }}
          >
            <div className="mx-auto flex max-w-content flex-col gap-1 md:flex-row md:items-center">
              <NavLink
                className={getNavClassName}
                to="/practice"
                onClick={closeMenu}
              >
                {navigationT('practice')}
              </NavLink>
              {role !== 'GUEST' ? (
                <>
                  <NavLink
                    className={getNavClassName}
                    to="/wrong-notes"
                    onClick={closeMenu}
                  >
                    {navigationT('wrongNotes')}
                  </NavLink>
                  <NavLink
                    className={getNavClassName}
                    to="/bookmarks"
                    onClick={closeMenu}
                  >
                    {navigationT('bookmarks')}
                  </NavLink>
                  <NavLink
                    className={getNavClassName}
                    to="/dashboard"
                    onClick={closeMenu}
                  >
                    {navigationT('dashboard')}
                  </NavLink>
                </>
              ) : null}
              {role === 'ADMIN' ? (
                <NavLink
                  className={getNavClassName}
                  to="/admin/questions"
                  onClick={closeMenu}
                >
                  {navigationT('adminQuestions')}
                </NavLink>
              ) : null}
              <NavLink
                className={({ isActive }) =>
                  `${getNavClassName({ isActive })} min-w-0 max-w-full`
                }
                to="/login"
                onClick={closeMenu}
              >
                <span className="min-w-0 break-words md:max-w-40 md:truncate">
                  {user ? user.name : navigationT('login')}
                </span>
              </NavLink>
              <LocaleSwitcher />
            </div>
          </nav>
        </div>
      </header>

      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {routeAnnouncement && routeAnnouncement.locale === locale
          ? navigationT('routeChanged', {
              route: navigationT(getRouteLabelKey(routeAnnouncement.pathname))
            })
          : ''}
      </p>

      <main
        ref={mainRef}
        className="focus-visible:outline focus-visible:outline-focus focus-visible:outline-offset-focus-inset focus-visible:outline-brand"
        id="main-content"
        tabIndex={-1}
      >
        <Suspense
          fallback={
            <div
              className="mx-auto max-w-content px-4 py-16 text-center text-muted"
              role="status"
            >
              {commonT('loading.page')}
            </div>
          }
        >
          {isReady ? (
            <Outlet />
          ) : (
            <LoadingState message={commonT('loading.auth')} />
          )}
        </Suspense>
      </main>

      <footer className="border-t border-line bg-surface">
        <div className="mx-auto flex max-w-content flex-col gap-2 px-4 py-8 text-sm text-muted sm:px-6 md:flex-row md:items-center md:justify-between">
          <p>{commonT('footer.originalContent')}</p>
          <p>{commonT('footer.scope')}</p>
        </div>
      </footer>
    </div>
  )
}
