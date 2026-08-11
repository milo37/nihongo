import type { ComponentPropsWithoutRef, ReactElement } from 'react'
import { classNames } from '@common/components/classNames'

type SkeletonProps = Omit<ComponentPropsWithoutRef<'div'>, 'children'> & {
  label?: string
}

export const Skeleton = ({
  className,
  label = '콘텐츠를 불러오는 중입니다…',
  ...props
}: SkeletonProps): ReactElement => {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      <div
        className={classNames(
          'ui-skeleton min-h-4 rounded-md bg-slate-200',
          className
        )}
        aria-hidden="true"
        {...props}
      />
    </div>
  )
}
