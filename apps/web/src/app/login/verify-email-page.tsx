import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
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
  const { t: commonT } = useTranslation('common')
  const navigate = useNavigate()
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
      <section className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
        <ErrorState
          autoFocus
          description={t('verify.missingToken')}
          headingLevel={1}
          title={t('verify.invalidTitle')}
          action={
            <Button onClick={() => void navigate('/login')}>
              {commonT('actions.goLogin')}
            </Button>
          }
        />
      </section>
    )
  }

  if (verifyEmail.isSuccess) {
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
            {t('verify.successTitle')}
          </h1>
          <p className="mt-3 leading-7 text-emerald-900">
            {t('verify.successDescription')}
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
      <div className="rounded-xl border border-line bg-white p-6 shadow-soft">
        <h1 className="text-3xl font-black">{t('verify.title')}</h1>
        <p className="mt-3 leading-7 text-muted">{t('verify.description')}</p>
        {verifyEmail.isError ? (
          <p className="mt-5 text-sm text-red-700" role="alert">
            {t(getVerificationErrorKey(verifyEmail.error))}
          </p>
        ) : null}
        <Button
          className="mt-6"
          isLoading={verifyEmail.isPending}
          onClick={() => verifyEmail.mutate({ token })}
        >
          {t('verify.submit')}
        </Button>
      </div>
    </section>
  )
}
