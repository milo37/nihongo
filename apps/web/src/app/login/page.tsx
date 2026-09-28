import { lazy, Suspense, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
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
import { isMockApiMode } from '@libs/apiMode'
import { useAuth } from '@provider/ProtectedRouteProvider'

type AuthMode = 'RESET_REQUEST' | 'SIGN_IN' | 'SIGN_UP'
type SignInForm = z.input<typeof emailSignInSchema>
type SignUpForm = z.input<typeof emailSignUpSchema>
type ResetRequestForm = z.input<typeof passwordResetRequestSchema>
type RegistrationNotice = 'registration' | 'resetRequested'

const MockAuthenticationNotice = __NIHONGO_PRODUCTION_BUILD__
  ? null
  : lazy(() =>
      import('@mocks/components/MockAuthenticationNotice').then((module) => ({
        default: module.MockAuthenticationNotice
      }))
    )

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

export const LoginPage = (): ReactElement => {
  const { t } = useTranslation('auth')
  const { t: commonT } = useTranslation('common')
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [mode, setMode] = useState<AuthMode>('SIGN_IN')
  const [registrationNotice, setRegistrationNotice] =
    useState<RegistrationNotice>()
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
        setRegistrationNotice('registration')
        signUpForm.reset()
      }
    })
  }

  const submitResetRequest = (values: ResetRequestForm): void => {
    resetRequest.mutate(values, {
      onSuccess: () => {
        setRegistrationNotice('resetRequested')
        resetRequestForm.reset()
      }
    })
  }

  return (
    <section className="mx-auto max-w-5xl px-4 py-14 sm:px-6 lg:py-20">
      <div className="max-w-2xl">
        <p className="text-sm font-black tracking-[0.16em] text-brand">
          {t('eyebrow')}
        </p>
        <h1 className="mt-2 text-4xl font-black tracking-tight">
          {t('title')}
        </h1>
        <p className="mt-4 leading-7 text-muted">
          {isMockApiMode ? t('description.mock') : t('description.real')}
        </p>
        {isMockApiMode && MockAuthenticationNotice ? (
          <Suspense
            fallback={
              <p className="mt-4 text-sm text-muted" role="status">
                {commonT('loading.mockNotice')}
              </p>
            }
          >
            <MockAuthenticationNotice />
          </Suspense>
        ) : null}
      </div>

      {user ? (
        <div className="mt-8 flex flex-col gap-4 rounded-xl border border-line bg-white p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm text-muted">{t('currentAccount')}</p>
            <p className="mt-1 font-black">
              {user.name} · {role}
            </p>
          </div>
          <Button
            variant="secondary"
            isLoading={logout.isPending}
            onClick={() => logout.mutate()}
          >
            {t('logout')}
          </Button>
        </div>
      ) : null}

      <div className="mt-10 grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)]">
        <article className="rounded-xl border border-line bg-white p-6 shadow-soft sm:p-8">
          <div
            className="grid grid-cols-2 gap-2 rounded-lg bg-slate-100 p-1"
            role="group"
            aria-label={t('methodLabel')}
          >
            <Button
              aria-pressed={mode === 'SIGN_IN'}
              variant={mode === 'SIGN_IN' ? 'primary' : 'ghost'}
              onClick={() => handleModeChange('SIGN_IN')}
            >
              {t('signIn')}
            </Button>
            <Button
              aria-describedby={isMockApiMode ? 'mock-auth-notice' : undefined}
              aria-pressed={mode === 'SIGN_UP'}
              disabled={isMockApiMode}
              variant={mode === 'SIGN_UP' ? 'primary' : 'ghost'}
              onClick={() => handleModeChange('SIGN_UP')}
            >
              {t('signUp')}
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
                label={t('fields.email')}
                type="email"
                autoComplete="email"
                error={
                  signInForm.formState.errors.email
                    ? t('validation.email')
                    : undefined
                }
                {...signInForm.register('email')}
              />
              <Input
                label={t('fields.password')}
                type="password"
                autoComplete="current-password"
                hint={t('hints.password')}
                error={
                  signInForm.formState.errors.password
                    ? t(
                        signInForm.formState.errors.password.type === 'too_big'
                          ? 'validation.passwordMax'
                          : 'validation.passwordMin'
                      )
                    : undefined
                }
                {...signInForm.register('password')}
              />
              {signIn.isError ? (
                <p
                  className="text-sm text-red-700"
                  role="alert"
                  aria-live="polite"
                >
                  {t('errors.request')}
                </p>
              ) : null}
              <Button type="submit" fullWidth isLoading={signIn.isPending}>
                {t('signIn')}
              </Button>
              <Button
                aria-describedby={
                  isMockApiMode ? 'mock-auth-notice' : undefined
                }
                disabled={isMockApiMode}
                type="button"
                variant="ghost"
                onClick={() => handleModeChange('RESET_REQUEST')}
              >
                {t('forgotPassword')}
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
                label={t('fields.name')}
                autoComplete="name"
                error={
                  signUpForm.formState.errors.name
                    ? t(
                        signUpForm.formState.errors.name.type === 'too_big'
                          ? 'validation.nameMax'
                          : 'validation.nameRequired'
                      )
                    : undefined
                }
                {...signUpForm.register('name')}
              />
              <Input
                label={t('fields.email')}
                type="email"
                autoComplete="email"
                error={
                  signUpForm.formState.errors.email
                    ? t('validation.email')
                    : undefined
                }
                {...signUpForm.register('email')}
              />
              <Input
                label={t('fields.password')}
                type="password"
                autoComplete="new-password"
                hint={t('hints.newPassword')}
                error={
                  signUpForm.formState.errors.password
                    ? t(
                        signUpForm.formState.errors.password.type === 'too_big'
                          ? 'validation.passwordMax'
                          : 'validation.passwordMin'
                      )
                    : undefined
                }
                {...signUpForm.register('password')}
              />
              <Select
                label={t('fields.targetLevel')}
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
                  {t(`notices.${registrationNotice}`)}
                </p>
              ) : null}
              {signUp.isError ? (
                <p
                  className="text-sm text-red-700"
                  role="alert"
                  aria-live="polite"
                >
                  {t('errors.request')}
                </p>
              ) : null}
              <Button type="submit" fullWidth isLoading={signUp.isPending}>
                {t('signUpAction')}
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
                <h2 className="text-xl font-black">{t('reset.title')}</h2>
                <p className="mt-2 text-sm leading-6 text-muted">
                  {t('reset.description')}
                </p>
              </div>
              <Input
                label={t('fields.email')}
                type="email"
                autoComplete="email"
                error={
                  resetRequestForm.formState.errors.email
                    ? t('validation.email')
                    : undefined
                }
                {...resetRequestForm.register('email')}
              />
              {registrationNotice ? (
                <p
                  className="text-sm text-emerald-800"
                  role="status"
                  aria-live="polite"
                >
                  {t(`notices.${registrationNotice}`)}
                </p>
              ) : null}
              {resetRequest.isError ? (
                <p className="text-sm text-red-700" role="alert">
                  {t('errors.resetRequest')}
                </p>
              ) : null}
              <Button
                type="submit"
                fullWidth
                isLoading={resetRequest.isPending}
              >
                {t('reset.requestAction')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => handleModeChange('SIGN_IN')}
              >
                {t('reset.backToLogin')}
              </Button>
            </form>
          )}
        </article>

        <article className="flex flex-col rounded-xl border border-line bg-slate-950 p-6 text-white shadow-soft sm:p-8">
          <p className="text-sm font-black tracking-[0.12em] text-emerald-300">
            {t('guest.eyebrow')}
          </p>
          <h2 className="mt-3 text-2xl font-black">{t('guest.title')}</h2>
          <p className="mt-3 flex-1 leading-7 text-slate-300">
            {isMockApiMode
              ? t('guest.descriptionMock')
              : t('guest.descriptionReal')}
          </p>
          <Button
            className="mt-7 w-full"
            variant="outline"
            isLoading={logout.isPending}
            loadingLabel={t('guest.loading')}
            onClick={handleGuest}
          >
            {t('guest.continue')}
          </Button>
        </article>
      </div>
    </section>
  )
}
