import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { ReactElement } from 'react'
import { useVerifyEmail } from '@app/login/hooks/useVerifyEmail'
import { Button } from '@common/components/Button'
import { ErrorState } from '@common/components/ErrorState'
import { isApiError } from '@api/config'

const readVerificationToken = (): string | null => {
  if (typeof window === 'undefined') {
    return null
  }

  const fragment = window.location.hash.slice(1)
  const token = new URLSearchParams(fragment).get('token')?.trim() ?? ''
  return token || null
}

type VerificationErrorKey =
  | 'errors.verifyUnsupported'
  | 'errors.temporary'
  | 'errors.verifyExpired'

const getVerificationErrorKey = (error: unknown): VerificationErrorKey => {
  if (isApiError(error) && error.code === 'MOCK_AUTH_UNSUPPORTED') {
    return 'errors.verifyUnsupported'
  }
  if (
    isApiError(error) &&
    (error.isNetworkError || error.isServerError || error.status === 429)
  ) {
    return 'errors.temporary'
  }
  return 'errors.verifyExpired'
}

export const VerifyEmailPage = (): ReactElement => {
  const { t } = useTranslation('auth')
  const [token] = useState(readVerificationToken)
  const verifyEmail = useVerifyEmail()
  const successHeadingRef = useRef<HTMLHeadingElement>(null)

  useLayoutEffect(() => {
    if (window.location.hash) {
      window.history.replaceState(
        window.history.state,
        '',
        `${window.location.pathname}${window.location.search}`
      )
    }
  }, [])

  useEffect(() => {
    if (verifyEmail.isSuccess) {
      successHeadingRef.current?.focus()
    }
  }, [verifyEmail.isSuccess])

  if (!token) {
    return (
      <section className="auth-page">
        <div className="auth-panel auth-standalone-panel">
          <ErrorState
            className="auth-link-error"
            autoFocus
            description={t('verify.missingToken')}
            headingLevel={1}
            title={t('verify.invalidTitle')}
            action={
              <Link
                className="inline-flex min-h-11 items-center justify-center rounded-control bg-brand px-4 py-2.5 text-sm font-semibold text-on-accent shadow-control hover:bg-brand-strong focus-visible:outline focus-visible:outline-focus focus-visible:outline-offset-focus focus-visible:outline-brand"
                to="/login"
              >
                {t('verify.recoveryAction')}
              </Link>
            }
          />
        </div>
      </section>
    )
  }

  if (verifyEmail.isSuccess) {
    return (
      <section className="auth-page">
        <div className="auth-panel auth-standalone-panel">
          <div className="auth-result">
            <h1
              ref={successHeadingRef}
              className="auth-result-title"
              tabIndex={-1}
            >
              {t('verify.successTitle')}
            </h1>
            <p className="auth-result-description">
              {t('verify.successDescription')}
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
        <div className="auth-result">
          <h1 className="auth-result-title">{t('verify.title')}</h1>
          <p className="auth-result-description">{t('verify.description')}</p>
          {verifyEmail.isError ? (
            <p className="auth-error" role="alert">
              {t(getVerificationErrorKey(verifyEmail.error))}
            </p>
          ) : null}
          <Button
            fullWidth
            size="lg"
            className="mt-6"
            isLoading={verifyEmail.isPending}
            onClick={() => verifyEmail.mutate({ token })}
          >
            {t('verify.submit')}
          </Button>
        </div>
      </div>
    </section>
  )
}
