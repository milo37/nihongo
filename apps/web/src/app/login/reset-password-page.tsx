import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { ReactElement } from 'react'
import type { z } from 'zod'
import { useResetPassword } from '@app/login/hooks/useResetPassword'
import { Button } from '@common/components/Button'
import { ErrorState } from '@common/components/ErrorState'
import { Input } from '@common/components/Input'
import { passwordResetConfirmSchema } from '@common/schemas/auth'
import { isApiError } from '@api/config'
import { isMockApiMode } from '@libs/apiMode'
import { useAuth } from '@provider/ProtectedRouteProvider'

type ResetPasswordForm = Pick<
  z.input<typeof passwordResetConfirmSchema>,
  'newPassword'
>

const readResetPasswordToken = (): string | null => {
  if (typeof window === 'undefined') {
    return null
  }

  const fragmentToken = new URLSearchParams(window.location.hash.slice(1))
    .get('token')
    ?.trim()
  const legacyQueryToken = new URLSearchParams(window.location.search)
    .get('token')
    ?.trim()
  return fragmentToken || legacyQueryToken || null
}

type ResetPasswordErrorKey =
  | 'errors.resetUnsupported'
  | 'errors.temporary'
  | 'errors.resetExpired'

const getResetPasswordErrorKey = (error: unknown): ResetPasswordErrorKey => {
  if (isApiError(error) && error.code === 'MOCK_AUTH_UNSUPPORTED') {
    return 'errors.resetUnsupported'
  }
  if (
    isApiError(error) &&
    (error.isNetworkError || error.isServerError || error.status === 429)
  ) {
    return 'errors.temporary'
  }
  return 'errors.resetExpired'
}

export const ResetPasswordPage = (): ReactElement => {
  const { t } = useTranslation('auth')
  const { t: commonT } = useTranslation('common')
  const { isReady, user } = useAuth()
  const [token] = useState(readResetPasswordToken)
  const resetPassword = useResetPassword()
  const [showPassword, setShowPassword] = useState(false)
  const successHeadingRef = useRef<HTMLHeadingElement>(null)
  const form = useForm<ResetPasswordForm>({
    resolver: zodResolver(
      passwordResetConfirmSchema.pick({ newPassword: true })
    ),
    defaultValues: { newPassword: '' }
  })

  useLayoutEffect(() => {
    const url = new URL(window.location.href)
    url.hash = ''
    url.searchParams.delete('token')
    window.history.replaceState(
      window.history.state,
      '',
      `${url.pathname}${url.search}`
    )
  }, [])

  useEffect(() => {
    if (resetPassword.isSuccess) {
      successHeadingRef.current?.focus()
    }
  }, [resetPassword.isSuccess])

  if (!token) {
    return (
      <section className="auth-page">
        <div className="auth-panel auth-standalone-panel">
          <ErrorState
            className="auth-link-error"
            description={
              !isReady
                ? commonT('loading.auth')
                : isMockApiMode
                  ? t('reset.missingTokenMock')
                  : user
                    ? t('reset.missingTokenMember')
                    : t('reset.missingToken')
            }
            headingLevel={1}
            title={t('reset.invalidTitle')}
            action={
              isReady ? (
                <Link
                  className="inline-flex min-h-11 items-center justify-center rounded-control bg-brand px-4 py-2.5 text-sm font-semibold text-on-accent shadow-control hover:bg-brand-strong focus-visible:outline focus-visible:outline-focus focus-visible:outline-offset-focus focus-visible:outline-brand"
                  to={isMockApiMode ? '/login' : '/login?mode=reset'}
                >
                  {user
                    ? t('reset.recoveryAccount')
                    : isMockApiMode
                      ? t('reset.recoveryLogin')
                      : t('reset.requestAction')}
                </Link>
              ) : undefined
            }
          />
        </div>
      </section>
    )
  }

  if (resetPassword.isSuccess) {
    return (
      <section className="auth-page">
        <div className="auth-panel auth-standalone-panel">
          <div className="auth-result">
            <h1
              ref={successHeadingRef}
              className="auth-result-title"
              tabIndex={-1}
            >
              {t('reset.successTitle')}
            </h1>
            <p className="auth-result-description">
              {t('reset.successDescription')}
            </p>
            <Link
              className="mt-6 inline-flex min-h-11 items-center justify-center rounded-control bg-brand px-4 py-2.5 text-sm font-semibold text-on-accent shadow-control hover:bg-brand-strong focus-visible:outline focus-visible:outline-focus focus-visible:outline-offset-focus focus-visible:outline-brand"
              to="/login"
            >
              {t('signIn')}
            </Link>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="auth-page">
      <div className="auth-panel auth-standalone-panel">
        <h1 className="auth-result-title">{t('reset.formTitle')}</h1>
        <p className="auth-result-description">{t('reset.formDescription')}</p>
        <form
          className="auth-fields"
          aria-busy={resetPassword.isPending || undefined}
          noValidate
          onSubmit={(event) => {
            void form.handleSubmit((values) => {
              resetPassword.mutate({ ...values, token })
            })(event)
          }}
        >
          <div className="auth-password">
            <Input
              className="auth-input"
              label={t('fields.newPassword')}
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              error={
                form.formState.errors.newPassword
                  ? t(
                      form.formState.errors.newPassword.type === 'too_big'
                        ? 'validation.newPasswordMax'
                        : 'validation.newPasswordMin'
                    )
                  : undefined
              }
              {...form.register('newPassword')}
            />
            <button
              className="auth-reveal"
              type="button"
              aria-pressed={showPassword}
              disabled={resetPassword.isPending}
              aria-label={`${t('fields.newPassword')} ${t(showPassword ? 'hidePassword' : 'showPassword')}`}
              onClick={() => setShowPassword((visible) => !visible)}
            >
              {t(showPassword ? 'hidePassword' : 'showPassword')}
            </button>
          </div>
          {resetPassword.isError ? (
            <p className="auth-error" role="alert">
              {t(getResetPasswordErrorKey(resetPassword.error))}
            </p>
          ) : null}
          <Button type="submit" fullWidth isLoading={resetPassword.isPending}>
            {t('reset.submit')}
          </Button>
        </form>
      </div>
    </section>
  )
}
