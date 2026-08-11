import { useSearchParams, useNavigate } from 'react-router'
import type { ReactElement } from 'react'
import { Button } from '@common/components/Button'
import { useLoginDemoAdmin } from '@app/login/hooks/useLoginDemoAdmin'
import { useLoginDemoUser } from '@app/login/hooks/useLoginDemoUser'
import { useLogoutUser } from '@app/login/hooks/useLogoutUser'
import { useDemoAuth } from '@provider/ProtectedRouteProvider'
import { useAppStore } from '@store/index'

const getSafeRedirect = (redirect: string | null): string => {
  if (!redirect || !redirect.startsWith('/') || redirect.startsWith('//')) {
    return '/'
  }
  return redirect
}

const getGuestRedirect = (redirect: string): string => {
  if (redirect === '/' || redirect === '/practice') {
    return redirect
  }

  if (redirect.startsWith('/practice/')) {
    return '/practice'
  }

  return '/'
}

export const LoginPage = (): ReactElement => {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { user, role } = useDemoAuth()
  const setCurrentUser = useAppStore((state) => state.setCurrentUser)
  const continueAsGuest = useAppStore((state) => state.continueAsGuest)
  const resetPractice = useAppStore((state) => state.resetPractice)
  const loginUser = useLoginDemoUser()
  const loginAdmin = useLoginDemoAdmin()
  const logout = useLogoutUser()
  const redirect = getSafeRedirect(searchParams.get('redirect'))

  const completeLogin = (
    nextUser: Parameters<typeof setCurrentUser>[0]
  ): void => {
    resetPractice()
    setCurrentUser(nextUser)
    void navigate(redirect, { replace: true })
  }

  const handleGuest = (): void => {
    logout.mutate(undefined, {
      onSuccess: () => {
        resetPractice()
        continueAsGuest()
        void navigate(getGuestRedirect(redirect), { replace: true })
      }
    })
  }

  const handleLogout = (): void => {
    logout.mutate(undefined, {
      onSuccess: () => {
        resetPractice()
        setCurrentUser(null)
      }
    })
  }

  return (
    <section className="mx-auto max-w-5xl px-4 py-14 sm:px-6 lg:py-20">
      <div className="max-w-2xl">
        <p className="text-sm font-black tracking-[0.16em] text-brand">
          DEMO ACCESS
        </p>
        <h1 className="mt-2 text-4xl font-black tracking-tight">
          학습 역할을 선택하세요
        </h1>
        <p className="mt-4 leading-7 text-muted">
          실제 회원가입 없이 역할별 기능을 확인할 수 있습니다. 선택한 상태는 이
          브라우저에만 저장됩니다.
        </p>
      </div>

      {user ? (
        <div className="mt-8 flex flex-col gap-4 rounded-xl border border-line bg-white p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm text-muted">현재 데모 계정</p>
            <p className="mt-1 font-black">
              {user.name} · {role}
            </p>
          </div>
          <Button
            variant="secondary"
            isLoading={logout.isPending}
            onClick={handleLogout}
          >
            로그아웃
          </Button>
        </div>
      ) : null}

      <div className="mt-10 grid gap-4 lg:grid-cols-3">
        <article className="flex flex-col border-t-4 border-brand bg-white p-6 shadow-soft">
          <p className="text-sm font-black text-brand">USER</p>
          <h2 className="mt-3 text-2xl font-black">데모 학습자</h2>
          <p className="mt-3 flex-1 leading-7 text-muted">
            문제풀이, 오답노트, 즐겨찾기, 대시보드를 모두 사용할 수 있습니다.
            목표 급수는 N2입니다.
          </p>
          <Button
            className="mt-7 w-full"
            isLoading={loginUser.isPending}
            onClick={() => {
              loginUser.mutate(undefined, { onSuccess: completeLogin })
            }}
          >
            데모 학습자로 로그인
          </Button>
        </article>

        <article className="flex flex-col border-t-4 border-slate-950 bg-white p-6 shadow-soft">
          <p className="text-sm font-black text-slate-700">ADMIN</p>
          <h2 className="mt-3 text-2xl font-black">데모 관리자</h2>
          <p className="mt-3 flex-1 leading-7 text-muted">
            학습자 기능과 함께 문제 등록, 수정, 삭제를 포함한 관리자 CMS를
            확인할 수 있습니다.
          </p>
          <Button
            className="mt-7 w-full"
            variant="dark"
            isLoading={loginAdmin.isPending}
            onClick={() => {
              loginAdmin.mutate(undefined, { onSuccess: completeLogin })
            }}
          >
            데모 관리자로 로그인
          </Button>
        </article>

        <article className="flex flex-col border-t-4 border-slate-300 bg-white p-6 shadow-soft">
          <p className="text-sm font-black text-muted">GUEST</p>
          <h2 className="mt-3 text-2xl font-black">게스트 체험</h2>
          <p className="mt-3 flex-1 leading-7 text-muted">
            가입 없이 랜덤 문제풀이와 결과 확인이 가능합니다. 오답과 즐겨찾기는
            영구 저장되지 않습니다.
          </p>
          <Button
            className="mt-7 w-full"
            variant="secondary"
            isLoading={logout.isPending}
            loadingLabel="게스트로 전환 중…"
            onClick={handleGuest}
          >
            게스트로 계속
          </Button>
        </article>
      </div>
    </section>
  )
}
