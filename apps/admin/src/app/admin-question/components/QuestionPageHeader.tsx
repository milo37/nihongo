import { Link } from 'react-router'
import type { ReactElement, RefObject } from 'react'
import { WideScreenNotice } from '@app/admin/components/WideScreenNotice'
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'

type QuestionPageHeaderProps = {
  returnPath: string
  currentLabel: string
  currentClassName?: string
  title: string
  description: string
  headingRef?: RefObject<HTMLHeadingElement | null>
}

/** Breadcrumb, page heading and wide-screen notice shared by create and edit. */
export const QuestionPageHeader = ({
  returnPath,
  currentLabel,
  currentClassName,
  title,
  description,
  headingRef
}: QuestionPageHeaderProps): ReactElement => {
  const { t } = useAdminPresentation()
  return (
    <>
      <nav aria-label={t('common.breadcrumbLabel')}>
        <ol className="flex flex-wrap items-center gap-2 text-sm text-muted">
          <li>
            <Link
              className="rounded-md font-semibold text-brand underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              to={returnPath}
            >
              {t('common.questions')}
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li className={currentClassName} aria-current="page">
            {currentLabel}
          </li>
        </ol>
      </nav>

      <header className="mb-8 mt-4 border-b border-line pb-8">
        <h1
          ref={headingRef}
          className={
            headingRef
              ? 'rounded-sm text-balance text-3xl font-black tracking-tight sm:text-4xl'
              : 'text-balance text-3xl font-black tracking-tight sm:text-4xl'
          }
          tabIndex={headingRef ? -1 : undefined}
        >
          {title}
        </h1>
        <p className="mt-4 max-w-3xl text-pretty leading-7 text-muted">
          {description}
        </p>
      </header>
      <WideScreenNotice />
    </>
  )
}
