import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import type { ReactElement } from 'react'
import type { z } from 'zod'
import { useResetPassword } from '@app/login/hooks/useResetPassword'
import { Button } from '@common/components/Button'
import { ErrorState } from '@common/components/ErrorState'
import { Input } from '@common/components/Input'
import { passwordResetConfirmSchema } from '@common/schemas/auth'
import { isApiError } from '@api/config'

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
  const navigate = useNavigate()
  const [token] = useState(readResetPasswordToken)
  const resetPassword = useResetPassword()
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
      <section className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
        <ErrorState
          description={t('reset.missingToken')}
          headingLevel={1}
          title={t('reset.invalidTitle')}
          action={
            <Button onClick={() => void navigate('/login')}>
              {commonT('actions.goLogin')}
            </Button>
          }
        />
      </section>
    )
  }

  if (resetPassword.isSuccess) {
    return (
      <section className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
        <div
          className="rounded-xl border border-emerald-200 bg-emerald-50 p-6"
          role="status"
          aria-live="polite"
        >
          <h1
            ref={successHeadingRef}
            className="rounded-sm text-2xl font-black text-emerald-950"
            tabIndex={-1}
          >
            {t('reset.successTitle')}
          </h1>
          <p className="mt-3 leading-7 text-emerald-900">
            {t('reset.successDescription')}
          </p>
          <Button className="mt-6" onClick={() => void navigate('/login')}>
            {t('signIn')}
          </Button>
        </div>
      </section>
    )
  }

  return (
    <section className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
      <h1 className="text-3xl font-black">{t('reset.formTitle')}</h1>
      <p className="mt-3 leading-7 text-muted">{t('reset.formDescription')}</p>
      <form
        className="mt-8 grid gap-5 rounded-xl border border-line bg-white p-6"
        noValidate
        onSubmit={(event) => {
          void form.handleSubmit((values) => {
            resetPassword.mutate({ ...values, token })
          })(event)
        }}
      >
        <Input
          label={t('fields.newPassword')}
          type="password"
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
        {resetPassword.isError ? (
          <p className="text-sm text-red-700" role="alert">
            {t(getResetPasswordErrorKey(resetPassword.error))}
          </p>
        ) : null}
        <Button type="submit" fullWidth isLoading={resetPassword.isPending}>
          {t('reset.submit')}
        </Button>
      </form>
    </section>
  )
}
