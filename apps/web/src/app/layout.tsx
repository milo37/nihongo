import { Suspense, useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigationType } from 'react-router'
import type { ReactElement } from 'react'
import { LoadingState } from '@common/components/LoadingState'
import { useAuth } from '@provider/ProtectedRouteProvider'
import { useAppStore } from '@store/index'
import { isMockApiMode } from '@libs/apiMode'

const getNavClassName = ({ isActive }: { isActive: boolean }): string => {
  return [
    'rounded-lg px-3 py-2 text-sm font-semibold transition-colors',
    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
    isActive ? 'bg-emerald-50 text-brand' : 'text-slate-600 hover:text-ink'
  ].join(' ')
}

const getRouteLabel = (pathname: string): string => {
  if (pathname === '/') return '홈'
  if (pathname === '/login') return '로그인'
  if (pathname === '/reset-password') return '비밀번호 재설정'
  if (pathname === '/verify-email') return '이메일 인증'
  if (pathname === '/dashboard') return '학습 대시보드'
  if (pathname === '/practice') return '문제풀이 설정'
  if (pathname.startsWith('/practice/session/')) return '문제풀이'
  if (pathname.startsWith('/practice/result/')) return '학습 결과'
  if (pathname === '/wrong-notes') return '오답노트'
  if (pathname.startsWith('/wrong-notes/')) return '오답 상세'
  if (pathname === '/bookmarks') return '즐겨찾기'
  if (pathname === '/admin/questions/new') return '문제 등록'
  if (pathname.startsWith('/admin/questions/')) return '문제 수정'
  if (pathname === '/admin/questions') return '문제 관리'
  if (pathname === '/forbidden') return '접근 권한 없음'
  return '페이지'
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
  const { isReady, role, user } = useAuth()
  const location = useLocation()
  const navigationType = useNavigationType()
  const mainRef = useRef<HTMLElement>(null)
  const previousPathnameRef = useRef(location.pathname)
  const previousHashRef = useRef('')
  const [routeAnnouncement, setRouteAnnouncement] = useState('')
  const isMobileMenuOpen = useAppStore((state) => state.isMobileMenuOpen)
  const toggleMobileMenu = useAppStore((state) => state.toggleMobileMenu)
  const setMobileMenuOpen = useAppStore((state) => state.setMobileMenuOpen)

  useEffect(() => {
    const pathnameChanged = previousPathnameRef.current !== location.pathname
    const hashChanged = previousHashRef.current !== location.hash

    previousPathnameRef.current = location.pathname
    previousHashRef.current = location.hash

    if (!pathnameChanged && !hashChanged) {
      return
    }

    if (pathnameChanged) {
      setRouteAnnouncement('')
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
        setRouteAnnouncement(
          `${getRouteLabel(location.pathname)} 화면으로 이동했습니다.`
        )
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

  const closeMenu = (): void => {
    setMobileMenuOpen(false)
  }

  return (
    <div className="min-h-screen bg-slate-50 text-ink">
      <a
        className="sr-only z-[100] rounded-lg bg-white px-4 py-3 font-semibold focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
        href="#main-content"
      >
        본문으로 바로가기
      </a>
      <header className="sticky top-0 z-40 border-b border-line bg-white/95 backdrop-blur">
        <div className="mx-auto flex min-h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          <NavLink
            className="flex items-center gap-3 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"
            to="/"
            onClick={closeMenu}
          >
            <span
              className="grid size-10 place-items-center rounded-xl bg-emerald-700 font-black text-white"
              aria-hidden="true"
            >
              文
            </span>
            <span className="leading-tight">
              <strong className="block text-base">JLPT Drill Note</strong>
              <span className="block text-xs text-muted">
                풀고, 남기고, 다시
              </span>
            </span>
          </NavLink>

          <button
            className="grid min-h-11 min-w-11 place-items-center rounded-lg border border-line text-xl hover:border-slate-400 hover:bg-slate-50 md:hidden"
            type="button"
            aria-label={isMobileMenuOpen ? '메뉴 닫기' : '메뉴 열기'}
            aria-expanded={isMobileMenuOpen}
            aria-controls="primary-navigation"
            onClick={toggleMobileMenu}
          >
            <span aria-hidden="true">{isMobileMenuOpen ? '×' : '≡'}</span>
          </button>

          <nav
            id="primary-navigation"
            className={[
              'absolute inset-x-0 top-16 border-b border-line bg-white p-4 md:static md:block md:border-0 md:p-0',
              isMobileMenuOpen ? 'block' : 'hidden md:block'
            ].join(' ')}
            aria-label="주요 메뉴"
          >
            <div className="mx-auto flex max-w-7xl flex-col gap-1 md:flex-row md:items-center">
              <NavLink
                className={getNavClassName}
                to="/practice"
                onClick={closeMenu}
              >
                문제풀이
              </NavLink>
              {role !== 'GUEST' ? (
                <>
                  <NavLink
                    className={getNavClassName}
                    to="/wrong-notes"
                    onClick={closeMenu}
                  >
                    오답노트
                  </NavLink>
                  {isMockApiMode ? (
                    <NavLink
                      className={getNavClassName}
                      to="/bookmarks"
                      onClick={closeMenu}
                    >
                      즐겨찾기
                    </NavLink>
                  ) : null}
                  <NavLink
                    className={getNavClassName}
                    to="/dashboard"
                    onClick={closeMenu}
                  >
                    대시보드
                  </NavLink>
                </>
              ) : null}
              {role === 'ADMIN' && isMockApiMode ? (
                <NavLink
                  className={getNavClassName}
                  to="/admin/questions"
                  onClick={closeMenu}
                >
                  문제 관리
                </NavLink>
              ) : null}
              <NavLink
                className={getNavClassName}
                to="/login"
                onClick={closeMenu}
              >
                {user ? user.name : '로그인'}
              </NavLink>
            </div>
          </nav>
        </div>
      </header>

      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {routeAnnouncement}
      </p>

      <main
        ref={mainRef}
        className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand"
        id="main-content"
        tabIndex={-1}
      >
        <Suspense
          fallback={
            <div
              className="mx-auto max-w-7xl px-4 py-16 text-center text-muted"
              role="status"
            >
              페이지를 불러오는 중입니다…
            </div>
          }
        >
          {isReady ? (
            <Outlet />
          ) : (
            <LoadingState message="로그인 상태를 확인하고 있습니다…" />
          )}
        </Suspense>
      </main>

      <footer className="border-t border-line bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-8 text-sm text-muted sm:px-6 md:flex-row md:items-center md:justify-between">
          <p>자체 제작 문제만 사용하는 포트폴리오 프로젝트입니다.</p>
          <p>청해·실제 JLPT 기출문제는 포함하지 않습니다.</p>
        </div>
      </footer>
    </div>
  )
}
