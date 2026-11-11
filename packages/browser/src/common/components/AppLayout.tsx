import { Suspense, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Outlet, useHref, useLocation, useNavigationType } from 'react-router'
import { AppLink as Link } from './AppLink'
import { getAppPath } from '../../libs/appNavigation'
import type { ReactElement, ReactNode, RefObject } from 'react'
import { AppShell } from './AppShell'
import { Icon } from './Icon'
import { IconButton } from './IconButton'
import { LocaleSwitcher } from './LocaleSwitcher'
import { InformationFooter } from './InformationFooter'
import { LoadingState } from './LoadingState'
import { useDocumentMetadata } from '../hooks/useDocumentMetadata'
import { getRouteLabelKey } from '../../i18n/routePresentation'
import type { UiLocale } from '../../i18n/types'
import { useUiLocale } from '../../provider/I18nProvider'
import { useAuth } from '../../provider/ProtectedRouteProvider'
import { useAppStore } from '../../store/index'

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

type NavigationItem = {
  to: string
  label: 'learningStart' | 'wrongNotes' | 'bookmarks' | 'my'
  icon: 'house' | 'rotate-ccw' | 'bookmark' | 'user-round'
  active: boolean
}

const AppBrand = ({
  className,
  onClick
}: {
  className: string
  onClick: () => void
}): ReactElement => {
  const { t } = useTranslation('common')
  return (
    <Link className={className} to="/" onClick={onClick}>
      <img
        className="app-brand-lockup"
        src="/brand/harumaru-lockup.svg"
        width={770}
        height={210}
        alt={t('appName')}
      />
    </Link>
  )
}

const RouteAnnouncer = ({
  announcement
}: {
  announcement: { pathname: string; locale: UiLocale } | null
}): ReactElement => {
  const { t } = useTranslation('navigation')
  const { locale } = useUiLocale()
  return (
    <>
      <a
        className="sr-only z-skip-link rounded-lg bg-surface px-4 py-3 font-semibold focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:inline-flex focus:min-h-11 focus:min-w-11 focus:items-center"
        href="#main-content"
      >
        {t('skipToContent')}
      </a>
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement && announcement.locale === locale
          ? t('routeChanged', {
              route: t(getRouteLabelKey(announcement.pathname))
            })
          : ''}
      </p>
    </>
  )
}

// The same four links: in the top bar from 640px, as bottom tabs below it.
const PrimaryNavigation = ({
  variant,
  items,
  onNavigate
}: {
  variant: 'top' | 'bottom'
  items: readonly NavigationItem[]
  onNavigate: () => void
}): ReactElement => {
  const { t } = useTranslation('navigation')
  return (
    <nav
      id={variant === 'top' ? 'primary-navigation' : 'mobile-navigation'}
      className={
        variant === 'top' ? 'app-primary-navigation' : 'app-mobile-navigation'
      }
      aria-label={t(variant === 'top' ? 'primary' : 'mobilePrimary')}
    >
      {items.map((item) => (
        <Link
          key={item.to}
          to={item.to}
          className="app-nav-link"
          aria-current={item.active ? 'page' : undefined}
          onClick={onNavigate}
        >
          <Icon className="app-nav-icon" name={item.icon} />
          <span>{t(item.label)}</span>
        </Link>
      ))}
    </nav>
  )
}

type DefaultAccountMenuProps = {
  buttonRef: RefObject<HTMLButtonElement | null>
  onClose: () => void
}

// Used when the app supplies no account menu of its own (the admin app).
const DefaultAccountMenu = ({
  buttonRef,
  onClose
}: DefaultAccountMenuProps): ReactElement => {
  const { t } = useTranslation('navigation')
  const { role, user } = useAuth()
  const isOpen = useAppStore((state) => state.isMobileMenuOpen)
  const toggle = useAppStore((state) => state.toggleMobileMenu)
  const setOpen = useAppStore((state) => state.setMobileMenuOpen)
  return (
    <div className="app-account">
      <div className="app-desktop-locale">
        <LocaleSwitcher />
      </div>
      <div
        className="app-account-control"
        onBlur={(event) => {
          if (
            isOpen &&
            event.relatedTarget &&
            !event.currentTarget.contains(event.relatedTarget)
          ) {
            setOpen(false)
          }
        }}
      >
        <IconButton
          id="account-menu-button"
          ref={buttonRef}
          variant="ghost"
          label={t('account')}
          icon={<Icon name="user-round" />}
          aria-expanded={isOpen}
          aria-controls="account-navigation"
          onClick={toggle}
        />
        {isOpen ? (
          <nav
            id="account-navigation"
            className="app-account-menu"
            aria-label={t('account')}
          >
            <Link to="/login" onClick={onClose}>
              {user ? user.name : t('login')}
            </Link>
            {role !== 'GUEST' ? (
              <Link to="/dashboard?view=learning" onClick={onClose}>
                {t('learningStart')}
              </Link>
            ) : null}
            <div className="app-mobile-locale">
              <LocaleSwitcher />
            </div>
          </nav>
        ) : null}
      </div>
    </div>
  )
}

type AppLayoutProps = PracticeNavigationContext & {
  children?: ReactNode
  robots: 'index,follow' | 'noindex,follow'
  learnerNavigation?: boolean
  /** App-owned account menu; replaces the default menu and locale select. */
  accountMenu?: ReactNode
  /**
   * Top bar status just left of the account menu, such as the admin
   * re-verification chip. It stays on the same row on narrow screens and may
   * shrink, so keep its text short there.
   */
  headerStatus?: ReactNode
}

export const AppLayout = ({
  children,
  reviewReturnContext,
  robots,
  learnerNavigation = true,
  accountMenu,
  headerStatus
}: AppLayoutProps): ReactElement => {
  const { t: commonT } = useTranslation('common')
  const { locale } = useUiLocale()
  const { isReady } = useAuth()
  const routeLocation = useLocation()
  const basename = useHref('/')
  const location = {
    ...routeLocation,
    pathname: getAppPath(routeLocation.pathname, basename)
  }
  const navigationType = useNavigationType()
  const isLearningEntry =
    location.pathname === '/' ||
    (location.pathname === '/dashboard' &&
      new URLSearchParams(location.search).get('view') === 'learning')
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
  const setMobileMenuOpen = useAppStore((state) => state.setMobileMenuOpen)

  useDocumentMetadata({ robots })

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
  const navigationItems: readonly NavigationItem[] = [
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
    },
    {
      to: '/account',
      label: 'my',
      icon: 'user-round',
      active: location.pathname.startsWith('/account')
    }
  ]
  const showNavigation = learnerNavigation && !isFocusSession
  const shellClassName = isFocusSession
    ? 'app-shell-focus'
    : learnerNavigation
      ? undefined
      : 'app-shell-no-rail'
  const surface = isReviewSurface
    ? 'review'
    : isLearningActive
      ? 'learning'
      : 'general'
  const content =
    children !== undefined ? (
      children
    ) : isReady ? (
      <Outlet
        context={{ reviewReturnContext } satisfies PracticeNavigationContext}
      />
    ) : (
      <LoadingState message={commonT('loading.auth')} />
    )

  return (
    <AppShell
      className={shellClassName}
      surface={surface}
      beforeMain={<RouteAnnouncer announcement={routeAnnouncement} />}
      header={
        !isFocusSession ? (
          <header className="app-shell-header">
            <div className="app-shell-header-inner">
              <AppBrand
                className="app-brand app-mobile-brand"
                onClick={closeMenu}
              />
              {showNavigation ? (
                <PrimaryNavigation
                  variant="top"
                  items={navigationItems}
                  onNavigate={closeMenu}
                />
              ) : null}

              <div className="app-shell-header-actions">
                {headerStatus ? (
                  <div className="app-shell-header-status">{headerStatus}</div>
                ) : null}
                {accountMenu ?? (
                  <DefaultAccountMenu
                    buttonRef={mobileMenuButtonRef}
                    onClose={closeMenu}
                  />
                )}
              </div>
            </div>
          </header>
        ) : null
      }
      // Learners find the information links at the bottom of 마이 (/account).
      footer={
        !isFocusSession && !learnerNavigation ? (
          <InformationFooter density="compact" />
        ) : null
      }
      bottomNavigation={
        showNavigation ? (
          <PrimaryNavigation
            variant="bottom"
            items={navigationItems}
            onNavigate={closeMenu}
          />
        ) : null
      }
      mainProps={{
        ref: mainRef,
        // main is only where focus lands after a page move (screen readers
        // start reading from here); it is not a control, so it draws no ring.
        className: 'outline-none',
        id: 'main-content',
        tabIndex: -1
      }}
    >
      <Suspense fallback={<LoadingState message={commonT('loading.page')} />}>
        {content}
      </Suspense>
    </AppShell>
  )
}
