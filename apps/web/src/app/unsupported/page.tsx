import { Link } from 'react-router'
import type { ReactElement } from 'react'

type UnsupportedFeaturePageProps = {
  description: string
  title: string
}

export const UnsupportedFeaturePage = ({
  description,
  title
}: UnsupportedFeaturePageProps): ReactElement => (
  <section className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6">
    <p className="text-sm font-black tracking-[0.16em] text-amber-700">
      REAL API · NOT AVAILABLE
    </p>
    <h1 className="mt-3 text-3xl font-black">{title}</h1>
    <p className="mx-auto mt-4 max-w-xl leading-7 text-muted">{description}</p>
    <Link
      className="mt-7 inline-flex min-h-11 items-center rounded-lg bg-brand px-5 font-bold text-white"
      to="/practice"
    >
      RANDOM 학습으로 이동
    </Link>
  </section>
)
