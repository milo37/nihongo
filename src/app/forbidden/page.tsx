import { Link } from 'react-router'
import type { ReactElement } from 'react'

export const ForbiddenPage = (): ReactElement => {
  return (
    <section className="mx-auto max-w-2xl px-4 py-20 text-center">
      <p className="mb-3 text-sm font-bold text-amber-700">
        403 · 접근 권한 없음
      </p>
      <h1 className="text-3xl font-black">이 페이지를 볼 권한이 없습니다</h1>
      <p className="mt-4 text-muted">
        관리자 계정이 필요한 화면입니다. 데모 관리자로 로그인해 주세요.
      </p>
      <Link
        className="mt-8 inline-flex min-h-11 items-center rounded-lg bg-brand px-5 font-bold text-white hover:bg-emerald-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        to="/login"
      >
        로그인 선택으로 이동
      </Link>
    </section>
  )
}
