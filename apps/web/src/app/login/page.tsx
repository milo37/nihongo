import { useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { useNavigate, useSearchParams } from 'react-router'
import type { ReactElement } from 'react'
import type { z } from 'zod'
import { useLogoutUser } from '@app/login/hooks/useLogoutUser'
import { useRequestPasswordReset } from '@app/login/hooks/useRequestPasswordReset'
import { useSignInUser } from '@app/login/hooks/useSignInUser'
import { useSignUpUser } from '@app/login/hooks/useSignUpUser'
import { Button } from '@common/components/Button'
import { Input } from '@common/components/Input'
import { Select } from '@common/components/Select'
import {
  emailSignInSchema,
  emailSignUpSchema,
  passwordResetRequestSchema
} from '@common/schemas/auth'
import { LEVELS } from '@common/types/domain'
import { useAuth } from '@provider/ProtectedRouteProvider'

type AuthMode = 'RESET_REQUEST' | 'SIGN_IN' | 'SIGN_UP'
type SignInForm = z.input<typeof emailSignInSchema>
type SignUpForm = z.input<typeof emailSignUpSchema>
type ResetRequestForm = z.input<typeof passwordResetRequestSchema>

const isMockAuthenticationMode =
  import.meta.env.VITE_ENABLE_MOCKS !== 'false' &&
  (import.meta.env.DEV || import.meta.env.VITE_ENABLE_MOCKS === 'true')

const levelOptions = LEVELS.map((level) => ({
  value: level,
  label: level
}))

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

  return redirect.startsWith('/practice/') ? '/practice' : '/'
}

const getMutationErrorMessage = (isError: boolean): string | undefined =>
  isError
    ? '인증 요청을 처리하지 못했습니다. 입력 정보와 네트워크 상태를 확인해 주세요.'
    : undefined

export const LoginPage = (): ReactElement => {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [mode, setMode] = useState<AuthMode>('SIGN_IN')
  const [registrationNotice, setRegistrationNotice] = useState<string>()
  const { user, role } = useAuth()
  const signIn = useSignInUser()
  const signUp = useSignUpUser()
  const resetRequest = useRequestPasswordReset()
  const logout = useLogoutUser()
  const redirect = getSafeRedirect(searchParams.get('redirect'))
  const signInForm = useForm<SignInForm>({
    resolver: zodResolver(emailSignInSchema),
    defaultValues: { email: '', password: '' }
  })
  const signUpForm = useForm<SignUpForm>({
    resolver: zodResolver(emailSignUpSchema),
    defaultValues: {
      email: '',
      name: '',
      password: '',
      targetLevel: 'N3'
    }
  })
  const resetRequestForm = useForm<ResetRequestForm>({
    resolver: zodResolver(passwordResetRequestSchema),
    defaultValues: { email: '' }
  })

  const completeLogin = (): void => {
    void navigate(redirect, { replace: true })
  }

  const handleGuest = (): void => {
    logout.mutate(undefined, {
      onSuccess: () => {
        void navigate(getGuestRedirect(redirect), { replace: true })
      }
    })
  }

  const handleModeChange = (nextMode: AuthMode): void => {
    setMode(nextMode)
    setRegistrationNotice(undefined)
    signIn.reset()
    signUp.reset()
    resetRequest.reset()
  }

  const submitSignIn = (values: SignInForm): void => {
    signIn.mutate(values, { onSuccess: completeLogin })
  }

  const submitSignUp = (values: SignUpForm): void => {
    signUp.mutate(values, {
      onSuccess: () => {
        setRegistrationNotice(
          '가입 요청을 완료했습니다. 받은 편지함에서 이메일 인증을 마친 뒤 로그인해 주세요.'
        )
        signUpForm.reset()
      }
    })
  }

  const submitResetRequest = (values: ResetRequestForm): void => {
    resetRequest.mutate(values, {
      onSuccess: () => {
        setRegistrationNotice(
          '가입 여부와 관계없이 요청을 접수했습니다. 계정이 존재하면 재설정 링크를 전송합니다.'
        )
        resetRequestForm.reset()
      }
    })
  }

  return (
    <section className="mx-auto max-w-5xl px-4 py-14 sm:px-6 lg:py-20">
      <div className="max-w-2xl">
        <p className="text-sm font-black tracking-[0.16em] text-brand">
          SECURE ACCESS
        </p>
        <h1 className="mt-2 text-4xl font-black tracking-tight">
          학습 계정으로 시작하세요
        </h1>
        <p className="mt-4 leading-7 text-muted">
          {isMockAuthenticationMode
            ? '현재 로컬 Mock 인증 모드입니다. 아래 데모 계정 로그인만 제공하며 인증 상태는 로컬 데모 저장소에만 보관됩니다.'
            : '이메일 인증을 마친 계정으로 로그인하면 오답노트와 학습 기록을 안전하게 이어갈 수 있습니다. 인증 정보는 브라우저 저장소가 아닌 보안 쿠키로 관리됩니다.'}
        </p>
        {isMockAuthenticationMode ? (
          <div
            id="mock-auth-notice"
            className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm leading-6 text-amber-950"
            role="status"
          >
            <p className="font-black">Mock 데모 계정</p>
            <p>USER: user@example.com / Demo-user-2026!</p>
            <p>ADMIN: admin@example.com / Demo-admin-2026!</p>
            <p className="mt-1">
              회원가입·이메일 인증·비밀번호 재설정은 VITE_ENABLE_MOCKS=false인
              real API 모드에서 확인해 주세요.
            </p>
          </div>
        ) : null}
      </div>

      {user ? (
        <div className="mt-8 flex flex-col gap-4 rounded-xl border border-line bg-white p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm text-muted">현재 계정</p>
            <p className="mt-1 font-black">
              {user.name} · {role}
            </p>
          </div>
          <Button
            variant="secondary"
            isLoading={logout.isPending}
            onClick={() => logout.mutate()}
          >
            로그아웃
          </Button>
        </div>
      ) : null}

      <div className="mt-10 grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)]">
        <article className="rounded-xl border border-line bg-white p-6 shadow-soft sm:p-8">
          <div
            className="grid grid-cols-2 gap-2 rounded-lg bg-slate-100 p-1"
            role="group"
            aria-label="인증 방식"
          >
            <Button
              aria-pressed={mode === 'SIGN_IN'}
              variant={mode === 'SIGN_IN' ? 'primary' : 'ghost'}
              onClick={() => handleModeChange('SIGN_IN')}
            >
              로그인
            </Button>
            <Button
              aria-describedby={
                isMockAuthenticationMode ? 'mock-auth-notice' : undefined
              }
              aria-pressed={mode === 'SIGN_UP'}
              disabled={isMockAuthenticationMode}
              variant={mode === 'SIGN_UP' ? 'primary' : 'ghost'}
              onClick={() => handleModeChange('SIGN_UP')}
            >
              회원가입
            </Button>
          </div>

          {mode === 'SIGN_IN' ? (
            <form
              className="mt-7 grid gap-5"
              noValidate
              onSubmit={(event) => {
                void signInForm.handleSubmit(submitSignIn)(event)
              }}
            >
              <Input
                label="이메일"
                type="email"
                autoComplete="email"
                error={signInForm.formState.errors.email?.message}
                {...signInForm.register('email')}
              />
              <Input
                label="비밀번호"
                type="password"
                autoComplete="current-password"
                hint="12자 이상 입력해 주세요."
                error={signInForm.formState.errors.password?.message}
                {...signInForm.register('password')}
              />
              {signIn.isError ? (
                <p
                  className="text-sm text-red-700"
                  role="alert"
                  aria-live="polite"
                >
                  {getMutationErrorMessage(true)}
                </p>
              ) : null}
              <Button type="submit" fullWidth isLoading={signIn.isPending}>
                로그인
              </Button>
              <Button
                aria-describedby={
                  isMockAuthenticationMode ? 'mock-auth-notice' : undefined
                }
                disabled={isMockAuthenticationMode}
                type="button"
                variant="ghost"
                onClick={() => handleModeChange('RESET_REQUEST')}
              >
                비밀번호를 잊으셨나요?
              </Button>
            </form>
          ) : mode === 'SIGN_UP' ? (
            <form
              className="mt-7 grid gap-5"
              noValidate
              onSubmit={(event) => {
                void signUpForm.handleSubmit(submitSignUp)(event)
              }}
            >
              <Input
                label="이름"
                autoComplete="name"
                error={signUpForm.formState.errors.name?.message}
                {...signUpForm.register('name')}
              />
              <Input
                label="이메일"
                type="email"
                autoComplete="email"
                error={signUpForm.formState.errors.email?.message}
                {...signUpForm.register('email')}
              />
              <Input
                label="비밀번호"
                type="password"
                autoComplete="new-password"
                hint="12자 이상 128자 이하로 입력해 주세요."
                error={signUpForm.formState.errors.password?.message}
                {...signUpForm.register('password')}
              />
              <Select
                label="목표 급수"
                options={levelOptions}
                error={signUpForm.formState.errors.targetLevel?.message}
                {...signUpForm.register('targetLevel')}
              />
              {registrationNotice ? (
                <p
                  className="text-sm text-emerald-800"
                  role="status"
                  aria-live="polite"
                >
                  {registrationNotice}
                </p>
              ) : null}
              {signUp.isError ? (
                <p
                  className="text-sm text-red-700"
                  role="alert"
                  aria-live="polite"
                >
                  {getMutationErrorMessage(true)}
                </p>
              ) : null}
              <Button type="submit" fullWidth isLoading={signUp.isPending}>
                이메일 인증 요청
              </Button>
            </form>
          ) : (
            <form
              className="mt-7 grid gap-5"
              noValidate
              onSubmit={(event) => {
                void resetRequestForm.handleSubmit(submitResetRequest)(event)
              }}
            >
              <div>
                <h2 className="text-xl font-black">비밀번호 재설정</h2>
                <p className="mt-2 text-sm leading-6 text-muted">
                  계정 이메일을 입력하면 1시간 동안 유효한 재설정 링크를
                  보냅니다.
                </p>
              </div>
              <Input
                label="이메일"
                type="email"
                autoComplete="email"
                error={resetRequestForm.formState.errors.email?.message}
                {...resetRequestForm.register('email')}
              />
              {registrationNotice ? (
                <p
                  className="text-sm text-emerald-800"
                  role="status"
                  aria-live="polite"
                >
                  {registrationNotice}
                </p>
              ) : null}
              {resetRequest.isError ? (
                <p className="text-sm text-red-700" role="alert">
                  재설정 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.
                </p>
              ) : null}
              <Button
                type="submit"
                fullWidth
                isLoading={resetRequest.isPending}
              >
                재설정 링크 요청
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => handleModeChange('SIGN_IN')}
              >
                로그인으로 돌아가기
              </Button>
            </form>
          )}
        </article>

        <article className="flex flex-col rounded-xl border border-line bg-slate-950 p-6 text-white shadow-soft sm:p-8">
          <p className="text-sm font-black tracking-[0.12em] text-emerald-300">
            GUEST
          </p>
          <h2 className="mt-3 text-2xl font-black">가입 없이 먼저 체험</h2>
          <p className="mt-3 flex-1 leading-7 text-slate-300">
            랜덤 문제풀이와 결과 확인을 바로 시작할 수 있습니다. 게스트 기록은
            계정에 자동 합쳐지지 않으며 오답노트와 즐겨찾기는 로그인 후 사용할
            수 있습니다.
          </p>
          <Button
            className="mt-7 w-full"
            variant="outline"
            isLoading={logout.isPending}
            loadingLabel="게스트 세션 준비 중…"
            onClick={handleGuest}
          >
            게스트로 계속
          </Button>
        </article>
      </div>
    </section>
  )
}
