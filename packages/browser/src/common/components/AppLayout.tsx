import { Suspense, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Outlet, useHref, useLocation, useNavigationType } from 'react-router'
import { AppLink as Link } from './AppLink'
import { getAppPath } from '../../libs/appNavigation'
import type { ReactElement, ReactNode, RefObject } from 'react'
import { AppShell } from './AppShell'
import { SideNavigation } from './SideNavigation'
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
  label: 'learningStart' | 'wrongNotes' | 'bookmarks'
  icon: 'house' | 'rotate-ccw' | 'bookmark'
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

const MobileNavigation = ({
  items,
  onNavigate
}: {
  items: readonly NavigationItem[]
  onNavigate: () => void
}): ReactElement => {
  const { t } = useTranslation('navigation')
  return (
    <nav
      id="mobile-navigation"
      className="app-mobile-navigation"
      aria-label={t('mobilePrimary')}
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

type AccountMenuProps = {
  buttonRef: RefObject<HTMLButtonElement | null>
  action: AppLayoutProps['accountMenuAction']
  onClose: () => void
}

const AccountMenu = ({
  buttonRef,
  action,
  onClose
}: AccountMenuProps): ReactElement => {
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
            {role !== 'GUEST' && action ? (
              <button
                type="button"
                onClick={() => {
                  onClose()
                  action.onSelect()
                }}
              >
                {action.label}
              </button>
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
  /** App-owned member action in the account menu, such as an error report. */
  accountMenuAction?: { label: string; onSelect: () => void }
}

export const AppLayout = ({
  children,
  reviewReturnContext,
  robots,
  learnerNavigation = true,
  accountMenuAction
}: AppLayoutProps): ReactElement => {
  const { t: commonT } = useTranslation('common')
  const { t: navigationT } = useTranslation('navigation')
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
      sidebar={
        showNavigation ? (
          <SideNavigation
            id="primary-navigation"
            label={navigationT('primary')}
            brand={<AppBrand className="app-brand" onClick={closeMenu} />}
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
              <AppBrand
                className="app-brand app-mobile-brand"
                onClick={closeMenu}
              />

              <AccountMenu
                buttonRef={mobileMenuButtonRef}
                action={accountMenuAction}
                onClose={closeMenu}
              />
            </div>
          </header>
        ) : null
      }
      footer={!isFocusSession ? <InformationFooter density="compact" /> : null}
      bottomNavigation={
        showNavigation ? (
          <MobileNavigation items={navigationItems} onNavigate={closeMenu} />
        ) : null
      }
      mainProps={{
        ref: mainRef,
        className:
          'focus-visible:outline focus-visible:outline-focus focus-visible:outline-offset-focus-inset focus-visible:outline-brand',
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
