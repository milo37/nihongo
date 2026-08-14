import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
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

const getResetPasswordErrorMessage = (error: unknown): string => {
  if (isApiError(error) && error.code === 'MOCK_AUTH_UNSUPPORTED') {
    return 'Mock 모드에서는 비밀번호 재설정을 지원하지 않습니다. real API 모드에서 다시 시도해 주세요.'
  }
  if (
    isApiError(error) &&
    (error.isNetworkError || error.isServerError || error.status === 429)
  ) {
    return '일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.'
  }
  return '링크가 만료되었거나 이미 사용되었습니다. 새 링크를 요청해 주세요.'
}

export const ResetPasswordPage = (): ReactElement => {
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
          description="재설정 토큰이 없습니다. 로그인 화면에서 새 링크를 요청해 주세요."
          headingLevel={1}
          title="유효하지 않은 재설정 링크"
          action={
            <Button onClick={() => void navigate('/login')}>
              로그인으로 이동
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
            비밀번호를 변경했습니다
          </h1>
          <p className="mt-3 leading-7 text-emerald-900">
            기존 로그인 세션은 모두 종료했습니다. 새 비밀번호로 다시 로그인해
            주세요.
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
      <h1 className="text-3xl font-black">새 비밀번호 설정</h1>
      <p className="mt-3 leading-7 text-muted">
        12자 이상 128자 이하의 새 비밀번호를 입력해 주세요.
      </p>
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
          label="새 비밀번호"
          type="password"
          autoComplete="new-password"
          error={form.formState.errors.newPassword?.message}
          {...form.register('newPassword')}
        />
        {resetPassword.isError ? (
          <p className="text-sm text-red-700" role="alert">
            {getResetPasswordErrorMessage(resetPassword.error)}
          </p>
        ) : null}
        <Button type="submit" fullWidth isLoading={resetPassword.isPending}>
          비밀번호 변경
        </Button>
      </form>
    </section>
  )
}
