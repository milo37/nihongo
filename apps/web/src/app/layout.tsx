import { Suspense, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Outlet, useLocation, useNavigationType } from 'react-router'
import type { ReactElement, ReactNode } from 'react'
import { readReviewReturnContext } from '@app/wrong-note/reviewReturnContext'
import { getStudyDraftPrincipalScope } from '@app/practice/draft/studyDraftPrincipalScope'
import { AppShell } from '@common/components/AppShell'
import { SideNavigation } from '@common/components/SideNavigation'
import { Icon } from '@common/components/Icon'
import { IconButton } from '@common/components/IconButton'
import { LocaleSwitcher } from '@common/components/LocaleSwitcher'
import { InformationFooter } from '@common/components/InformationFooter'
import { LoadingState } from '@common/components/LoadingState'
import { useDocumentMetadata } from '@common/hooks/useDocumentMetadata'
import { getRouteLabelKey } from '@/i18n/routePresentation'
import type { UiLocale } from '@/i18n/types'
import { useUiLocale } from '@provider/I18nProvider'
import { useAuth } from '@provider/ProtectedRouteProvider'
import { useAppStore } from '@store/index'

export type PracticeNavigationContext = {
  reviewReturnContext: { questionId: string; returnTo: string } | null
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

type LayoutProps = { children?: ReactNode }

export const Layout = ({ children }: LayoutProps): ReactElement => {
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
  const reviewSessionId = location.pathname.match(
    /^\/practice\/(?:session|result)\/([^/]+)$/u
  )?.[1]
  const reviewReturnContext = reviewSessionId
    ? readReviewReturnContext(
        getStudyDraftPrincipalScope(user),
        reviewSessionId
      )
    : null
  const isReviewSurface =
    location.pathname.startsWith('/wrong-notes') || Boolean(reviewReturnContext)
  const isPracticeSurface =
    location.pathname === '/practice' ||
    location.pathname.startsWith('/practice/')
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

  const isFocusSession =
    location.pathname.startsWith('/practice/session/') && !isReviewSurface
  const isLearningActive =
    (isLearningEntry || isPracticeSurface) && !isReviewSurface
  const navigationItems = [
    {
      to: '/practice',
      label: 'learningStart',
      icon: 'house',
      active: isLearningActive
    },
    {
      to: '/wrong-notes',
      label: 'wrongNotes',
      icon: 'rotate-ccw',
      active: isReviewSurface
    },
    {
      to: '/bookmarks',
      label: 'bookmarks',
      icon: 'bookmark',
      active: location.pathname.startsWith('/bookmarks')
    }
  ] as const

  const renderMobileNavigation = (): ReactElement => (
    <nav
      id="mobile-navigation"
      className="app-mobile-navigation"
      aria-label={navigationT('mobilePrimary')}
    >
      {navigationItems.map((item) => (
        <Link
          key={item.to}
          to={item.to}
          className="app-nav-link"
          aria-current={item.active ? 'page' : undefined}
          onClick={closeMenu}
        >
          <Icon className="app-nav-icon" name={item.icon} />
          <span>{navigationT(item.label)}</span>
        </Link>
      ))}
    </nav>
  )

  return (
    <AppShell
      className={isFocusSession ? 'app-shell-focus' : undefined}
      surface={
        isReviewSurface ? 'review' : isLearningActive ? 'learning' : 'general'
      }
      beforeMain={
        <>
          <a
            className="sr-only z-skip-link rounded-lg bg-surface px-4 py-3 font-semibold focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:inline-flex focus:min-h-11 focus:min-w-11 focus:items-center"
            href="#main-content"
          >
            {navigationT('skipToContent')}
          </a>
          <p className="sr-only" aria-live="polite" aria-atomic="true">
            {routeAnnouncement && routeAnnouncement.locale === locale
              ? navigationT('routeChanged', {
                  route: navigationT(
                    getRouteLabelKey(routeAnnouncement.pathname)
                  )
                })
              : ''}
          </p>
        </>
      }
      sidebar={
        !isFocusSession ? (
          <SideNavigation
            id="primary-navigation"
            label={navigationT('primary')}
            brand={
              <Link className="app-brand" to="/" onClick={closeMenu}>
                <Icon name="book-open" />
                <strong>{commonT('appName')}</strong>
              </Link>
            }
            items={navigationItems.map((item) => ({
              ...item,
              label: navigationT(item.label)
            }))}
            onNavigate={closeMenu}
          />
        ) : null
      }
      header={
        !isFocusSession ? (
          <header className="app-shell-header">
            <div className="app-shell-header-inner">
              <Link
                className="app-brand app-mobile-brand"
                to="/"
                onClick={closeMenu}
              >
                <Icon name="book-open" />
                <strong>{commonT('appName')}</strong>
              </Link>

              <div className="app-account">
                <div className="app-desktop-locale">
                  <LocaleSwitcher />
                </div>
                <div
                  className="app-account-control"
                  onBlur={(event) => {
                    if (
                      isMobileMenuOpen &&
                      event.relatedTarget &&
                      !event.currentTarget.contains(event.relatedTarget)
                    ) {
                      setMobileMenuOpen(false)
                    }
                  }}
                >
                  <IconButton
                    ref={mobileMenuButtonRef}
                    variant="ghost"
                    label={navigationT('account')}
                    icon={<Icon name="user-round" />}
                    aria-expanded={isMobileMenuOpen}
                    aria-controls="account-navigation"
                    onClick={toggleMobileMenu}
                  />
                  {isMobileMenuOpen ? (
                    <nav
                      id="account-navigation"
                      className="app-account-menu"
                      aria-label={navigationT('account')}
                    >
                      <Link to="/login" onClick={closeMenu}>
                        {user ? user.name : navigationT('login')}
                      </Link>
                      {role !== 'GUEST' ? (
                        <Link to="/dashboard?view=learning" onClick={closeMenu}>
                          {navigationT('learningStart')}
                        </Link>
                      ) : null}
                      {role === 'ADMIN' ? (
                        <Link to="/admin/questions" onClick={closeMenu}>
                          {navigationT('adminQuestions')}
                        </Link>
                      ) : null}
                      <div className="app-mobile-locale">
                        <LocaleSwitcher />
                      </div>
                    </nav>
                  ) : null}
                </div>
              </div>
            </div>
          </header>
        ) : null
      }
      footer={!isFocusSession ? <InformationFooter density="compact" /> : null}
      bottomNavigation={!isFocusSession ? renderMobileNavigation() : null}
      mainProps={{
        ref: mainRef,
        className:
          'focus-visible:outline focus-visible:outline-focus focus-visible:outline-offset-focus-inset focus-visible:outline-brand',
        id: 'main-content',
        tabIndex: -1
      }}
    >
      <Suspense fallback={<LoadingState message={commonT('loading.page')} />}>
        {children !== undefined ? (
          children
        ) : isReady ? (
          <Outlet
            context={
              { reviewReturnContext } satisfies PracticeNavigationContext
            }
          />
        ) : (
          <LoadingState message={commonT('loading.auth')} />
        )}
      </Suspense>
    </AppShell>
  )
}
