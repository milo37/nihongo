import { useTranslation } from 'react-i18next'
import type { ComponentPropsWithoutRef, ReactElement } from 'react'
import { classNames } from '@common/components/classNames'

type SkeletonProps = Omit<ComponentPropsWithoutRef<'div'>, 'children'> & {
  label?: string
}

export const Skeleton = ({
  className,
  label,
  ...props
}: SkeletonProps): ReactElement => {
  const { t } = useTranslation('common')

  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">{label ?? t('loading.content')}</span>
      <div
        className={classNames(
          'ui-skeleton min-h-4 rounded-control bg-line',
          className
        )}
        aria-hidden="true"
        {...props}
      />
    </div>
  )
}
