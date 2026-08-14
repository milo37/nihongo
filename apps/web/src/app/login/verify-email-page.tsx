import { useEffect, useLayoutEffect, useRef, useState } from 'react'
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

const getVerificationErrorMessage = (error: unknown): string => {
  if (isApiError(error) && error.code === 'MOCK_AUTH_UNSUPPORTED') {
    return 'Mock 모드에서는 이메일 인증을 지원하지 않습니다. real API 모드에서 다시 시도해 주세요.'
  }
  if (
    isApiError(error) &&
    (error.isNetworkError || error.isServerError || error.status === 429)
  ) {
    return '일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.'
  }
  return '링크가 만료되었거나 이미 사용되었습니다. 새 인증 메일을 요청해 주세요.'
}

export const VerifyEmailPage = (): ReactElement => {
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
          description="인증 토큰이 없습니다. 로그인 화면에서 인증 메일을 다시 요청해 주세요."
          headingLevel={1}
          title="유효하지 않은 이메일 인증 링크"
          action={
            <Button onClick={() => void navigate('/login')}>
              로그인으로 이동
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
            이메일 인증을 완료했습니다
          </h1>
          <p className="mt-3 leading-7 text-emerald-900">
            이제 가입한 이메일과 비밀번호로 로그인할 수 있습니다.
          </p>
          <Button className="mt-6" onClick={() => void navigate('/login')}>
            로그인
          </Button>
        </div>
      </section>
    )
  }

  return (
    <section className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
      <div className="rounded-xl border border-line bg-white p-6 shadow-soft">
        <h1 className="text-3xl font-black">이메일 주소 확인</h1>
        <p className="mt-3 leading-7 text-muted">
          아래 버튼을 누르면 이메일 주소 인증을 완료합니다. 링크를 직접 열기만
          해서는 계정 상태가 변경되지 않습니다.
        </p>
        {verifyEmail.isError ? (
          <p className="mt-5 text-sm text-red-700" role="alert">
            {getVerificationErrorMessage(verifyEmail.error)}
          </p>
        ) : null}
        <Button
          className="mt-6"
          isLoading={verifyEmail.isPending}
          onClick={() => verifyEmail.mutate({ token })}
        >
          이메일 인증하기
        </Button>
      </div>
    </section>
  )
}
