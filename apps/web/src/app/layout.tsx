import { Suspense, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Link,
  NavLink,
  Outlet,
  useLocation,
  useNavigationType
} from 'react-router'
import type { ReactElement } from 'react'
import { LearningIcon } from '@app/home/LearningIcon'
import { LocaleSwitcher } from '@common/components/LocaleSwitcher'
import { InformationFooter } from '@common/components/InformationFooter'
import { LoadingState } from '@common/components/LoadingState'
import { useDocumentMetadata } from '@common/hooks/useDocumentMetadata'
import { getRouteLabelKey } from '@/i18n/routePresentation'
import type { UiLocale } from '@/i18n/types'
import { useUiLocale } from '@provider/I18nProvider'
import { useAuth } from '@provider/ProtectedRouteProvider'
import { useAppStore } from '@store/index'

const getNavClassName = ({ isActive }: { isActive: boolean }): string => {
  return [
    'ui-primary-nav-item inline-flex min-h-11 items-center rounded-lg px-3 py-2 text-sm transition-colors',
    'focus-visible:outline focus-visible:outline-focus focus-visible:outline-offset-focus focus-visible:outline-brand',
    isActive
      ? 'ui-primary-nav-active bg-brand-soft text-brand font-semibold'
      : 'text-ink font-normal'
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
  const isLearningEntry =
    location.pathname === '/' ||
    (location.pathname === '/dashboard' &&
      new URLSearchParams(location.search).get('view') === 'learning')
  const isLearningSurface =
    isLearningEntry ||
    location.pathname.startsWith('/practice') ||
    location.pathname.startsWith('/wrong-notes')
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
    <div
      className={`app-shell bg-canvas text-ink ${isLearningSurface ? 'study-shell' : ''}`}
    >
      <a
        className="sr-only z-skip-link rounded-lg bg-surface px-4 py-3 font-semibold focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:inline-flex focus:min-h-11 focus:min-w-11 focus:items-center"
        href="#main-content"
      >
        {navigationT('skipToContent')}
      </a>
      <header className="app-shell-header">
        <div className="app-shell-header-inner">
          <NavLink
            className="app-brand flex min-h-11 min-w-0 items-center rounded-control focus-visible:outline focus-visible:outline-focus focus-visible:outline-offset-focus focus-visible:outline-brand"
            to="/"
            onClick={closeMenu}
          >
            <span className="min-w-0 leading-tight">
              <strong className="block text-base">JLPT Drill Note</strong>
              <span className="sr-only">{commonT('tagline')}</span>
            </span>
          </NavLink>

          <button
            ref={mobileMenuButtonRef}
            className="app-menu-toggle min-h-11 min-w-11 shrink-0 place-items-center rounded-control border border-line text-xl hover:border-line-strong hover:bg-surface-muted"
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
            <LearningIcon className="size-5" name="menu" />
          </button>

          <nav
            id="primary-navigation"
            className={[
              'app-primary-navigation',
              isMobileMenuOpen ? 'is-open' : ''
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
            <div className="app-navigation-items">
              <Link
                className={getNavClassName({ isActive: isLearningEntry })}
                to={role === 'GUEST' ? '/' : '/dashboard?view=learning'}
                aria-current={isLearningEntry ? 'page' : undefined}
                onClick={closeMenu}
              >
                {navigationT('learningStart')}
              </Link>
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
                    className={({ isActive }) =>
                      getNavClassName({
                        isActive: isActive && !isLearningEntry
                      })
                    }
                    to="/dashboard"
                    aria-current={isLearningEntry ? false : 'page'}
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

      <InformationFooter />
    </div>
  )
}
