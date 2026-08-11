import { Link } from 'react-router'
import type { ReactElement } from 'react'

export const NotFoundPage = (): ReactElement => {
  return (
    <section className="mx-auto max-w-2xl px-4 py-20 text-center">
      <p className="mb-3 text-sm font-bold text-brand">404 · 찾을 수 없음</p>
      <h1 className="text-3xl font-black">요청한 페이지가 없습니다</h1>
      <p className="mt-4 text-muted">
        주소를 확인하거나 홈에서 다시 시작해 주세요.
      </p>
      <Link
        className="mt-8 inline-flex min-h-11 items-center rounded-lg bg-brand px-5 font-bold text-white hover:bg-emerald-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        to="/"
      >
        홈으로 이동
      </Link>
    </section>
  )
}
