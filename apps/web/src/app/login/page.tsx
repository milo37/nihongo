import { lazy, Suspense, useEffect, useRef, useState } from 'react'
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
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedMode: AuthMode =
    searchParams.get('mode') === 'signup'
      ? 'SIGN_UP'
      : searchParams.get('mode') === 'reset'
        ? 'RESET_REQUEST'
        : 'SIGN_IN'
  const mode: AuthMode = isMockApiMode ? 'SIGN_IN' : requestedMode
  const [registrationNotice, setRegistrationNotice] =
    useState<RegistrationNotice>()
  const { isReady, user } = useAuth()
  const signIn = useSignInUser()
  const signUp = useSignUpUser()
  const resetRequest = useRequestPasswordReset()
  const logout = useLogoutUser()
  const noticeHeadingRef = useRef<HTMLHeadingElement>(null)
  const [showPassword, setShowPassword] = useState(false)
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

  useEffect(() => {
    if (
      !isMockApiMode ||
      (searchParams.get('mode') !== 'signup' &&
        searchParams.get('mode') !== 'reset')
    ) {
      return
    }
    const next = new URLSearchParams(searchParams)
    next.delete('mode')
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])

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
    const next = new URLSearchParams(searchParams)
    if (nextMode === 'SIGN_IN') next.delete('mode')
    else next.set('mode', nextMode === 'SIGN_UP' ? 'signup' : 'reset')
    setSearchParams(next)
    setShowPassword(false)
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

  useEffect(() => {
    if (registrationNotice) noticeHeadingRef.current?.focus()
  }, [registrationNotice])

  return (
    <section className="auth-page">
      <div className="auth-panel">
        <header className="auth-heading">
          <h1
            ref={noticeHeadingRef}
            tabIndex={registrationNotice ? -1 : undefined}
          >
            {!isReady
              ? t('checkingTitle')
              : user
                ? t('currentTitle')
                : registrationNotice
                  ? t(
                      registrationNotice === 'registration'
                        ? 'registrationTitle'
                        : 'requestTitle'
                    )
                  : mode === 'SIGN_UP'
                    ? t('signUp')
                    : mode === 'RESET_REQUEST'
                      ? t('reset.title')
                      : t('signIn')}
          </h1>
          <p>
            {!isReady
              ? commonT('loading.auth')
              : user
                ? t('currentDescription')
                : registrationNotice
                  ? t(`notices.${registrationNotice}`)
                  : mode === 'SIGN_UP'
                    ? t('signupDescription')
                    : mode === 'RESET_REQUEST'
                      ? t('reset.description')
                      : t('loginDescription')}
          </p>
        </header>
        {!isReady ? (
          <p className="auth-notice" role="status">
            {commonT('loading.auth')}
          </p>
        ) : user ? (
          <>
            <div className="auth-account">
              <p>{t('currentAccount')}</p>
              <strong>{user.name}</strong>
            </div>
            <div className="auth-actions">
              <Button fullWidth size="lg" onClick={completeLogin}>
                {t('continueAccount')}
              </Button>
              <Button
                fullWidth
                size="lg"
                variant="outline"
                isLoading={logout.isPending}
                onClick={() => logout.mutate()}
              >
                {t('changeAccount')}
              </Button>
            </div>
          </>
        ) : registrationNotice ? (
          <div className="auth-actions">
            <Button
              fullWidth
              size="lg"
              onClick={() => handleModeChange('SIGN_IN')}
            >
              {t('reset.backToLogin')}
            </Button>
          </div>
        ) : (
          <>
            {mode === 'SIGN_IN' ? (
              <form
                aria-busy={
                  signIn.isPending ||
                  signUp.isPending ||
                  resetRequest.isPending ||
                  undefined
                }
                className="auth-fields"
                noValidate
                onSubmit={(event) => {
                  void signInForm.handleSubmit(submitSignIn)(event)
                }}
              >
                <Input
                  className="auth-input"
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
                <div className="auth-password">
                  <Input
                    className="auth-input"
                    label={t('fields.password')}
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    hint={t('hints.password')}
                    error={
                      signInForm.formState.errors.password
                        ? t(
                            signInForm.formState.errors.password.type ===
                              'too_big'
                              ? 'validation.passwordMax'
                              : 'validation.passwordMin'
                          )
                        : undefined
                    }
                    {...signInForm.register('password')}
                  />
                  <button
                    className="auth-reveal"
                    type="button"
                    aria-pressed={showPassword}
                    disabled={signIn.isPending || signUp.isPending}
                    aria-label={`${t('fields.password')} ${t(showPassword ? 'hidePassword' : 'showPassword')}`}
                    onClick={() => setShowPassword((visible) => !visible)}
                  >
                    {t(showPassword ? 'hidePassword' : 'showPassword')}
                  </button>
                </div>
                {signIn.isError ? (
                  <p className="auth-error" role="alert" aria-live="polite">
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
                aria-busy={
                  signIn.isPending ||
                  signUp.isPending ||
                  resetRequest.isPending ||
                  undefined
                }
                className="auth-fields"
                noValidate
                onSubmit={(event) => {
                  void signUpForm.handleSubmit(submitSignUp)(event)
                }}
              >
                <Input
                  className="auth-input"
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
                  className="auth-input"
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
                <div className="auth-password">
                  <Input
                    className="auth-input"
                    label={t('fields.password')}
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    hint={t('hints.newPassword')}
                    error={
                      signUpForm.formState.errors.password
                        ? t(
                            signUpForm.formState.errors.password.type ===
                              'too_big'
                              ? 'validation.passwordMax'
                              : 'validation.passwordMin'
                          )
                        : undefined
                    }
                    {...signUpForm.register('password')}
                  />
                  <button
                    className="auth-reveal"
                    type="button"
                    aria-pressed={showPassword}
                    disabled={signIn.isPending || signUp.isPending}
                    aria-label={`${t('fields.password')} ${t(showPassword ? 'hidePassword' : 'showPassword')}`}
                    onClick={() => setShowPassword((visible) => !visible)}
                  >
                    {t(showPassword ? 'hidePassword' : 'showPassword')}
                  </button>
                </div>
                <Select
                  label={t('fields.targetLevel')}
                  options={levelOptions}
                  error={signUpForm.formState.errors.targetLevel?.message}
                  {...signUpForm.register('targetLevel')}
                />
                {signUp.isError ? (
                  <p className="auth-error" role="alert" aria-live="polite">
                    {t('errors.request')}
                  </p>
                ) : null}
                <Button type="submit" fullWidth isLoading={signUp.isPending}>
                  {t('signUpAction')}
                </Button>
              </form>
            ) : (
              <form
                aria-busy={
                  signIn.isPending ||
                  signUp.isPending ||
                  resetRequest.isPending ||
                  undefined
                }
                className="auth-fields"
                noValidate
                onSubmit={(event) => {
                  void resetRequestForm.handleSubmit(submitResetRequest)(event)
                }}
              >
                <Input
                  className="auth-input"
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
                {resetRequest.isError ? (
                  <p className="auth-error" role="alert">
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
            {mode === 'SIGN_IN' ? (
              <div
                className="auth-link-row"
                role="group"
                aria-label={t('methodLabel')}
              >
                <span>{t('signupPrompt')}</span>
                <button
                  type="button"
                  className="auth-text-link"
                  disabled={isMockApiMode}
                  aria-describedby={
                    isMockApiMode ? 'mock-auth-notice' : undefined
                  }
                  onClick={() => handleModeChange('SIGN_UP')}
                >
                  {t('signUp')}
                </button>
              </div>
            ) : mode === 'SIGN_UP' ? (
              <div className="auth-link-row">
                <button
                  type="button"
                  className="auth-text-link"
                  onClick={() => handleModeChange('SIGN_IN')}
                >
                  {t('reset.backToLogin')}
                </button>
              </div>
            ) : null}
          </>
        )}
        {logout.isError ? (
          <p className="auth-error" role="alert">
            {t('errors.logout')}
          </p>
        ) : null}
        {isReady && !user ? (
          <div className="auth-guest">
            <Button
              fullWidth
              size="lg"
              variant="outline"
              isLoading={logout.isPending}
              loadingLabel={t('guest.loading')}
              onClick={handleGuest}
            >
              {t('guest.continue')}
            </Button>
            <p>
              {isMockApiMode
                ? t('guest.descriptionMock')
                : t('guest.descriptionReal')}
            </p>
          </div>
        ) : null}
        {isMockApiMode && MockAuthenticationNotice ? (
          <Suspense
            fallback={
              <p className="auth-notice" role="status">
                {commonT('loading.mockNotice')}
              </p>
            }
          >
            <MockAuthenticationNotice />
          </Suspense>
        ) : null}
      </div>
    </section>
  )
}
