import { Link, useRouteError } from 'react-router'
import type { ReactElement } from 'react'

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }
  return '예상하지 못한 오류가 발생했습니다.'
}

export const RouteErrorPage = (): ReactElement => {
  const error = useRouteError()

  return (
    <section className="mx-auto max-w-2xl px-4 py-20 text-center" role="alert">
      <p className="mb-3 text-sm font-bold text-red-700">페이지 오류</p>
      <h1 className="text-3xl font-black">화면을 불러오지 못했습니다</h1>
      <p className="mt-4 text-muted">{getErrorMessage(error)}</p>
      <Link
        className="mt-8 inline-flex min-h-11 items-center rounded-lg bg-brand px-5 font-bold text-white hover:bg-emerald-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        to="/"
      >
        홈으로 이동
      </Link>
    </section>
  )
}
