import { Icon } from '@nihongo/browser/common/components/Icon'
import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { AdminListIcon } from '@app/admin/components/list/AdminListIcon'
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'

type CopyState = 'idle' | 'copied' | 'failed'

/** Copies text and reports the result for two seconds. */
export const useCopyText = () => {
  const [state, setState] = useState<CopyState>('idle')
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const copy = (text: string): void => {
    const settle = (next: CopyState): void => {
      setState(next)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setState('idle'), 2000)
    }
    if (!navigator.clipboard) {
      settle('failed')
      return
    }
    navigator.clipboard.writeText(text).then(
      () => settle('copied'),
      () => settle('failed')
    )
  }
  return { state, copy }
}

/** Live message for a copy result; stays mounted so it is announced. */
export const CopyStatus = ({
  state
}: {
  readonly state: CopyState
}): ReactElement => {
  const { t } = useAdminPresentation()
  return (
    <span role="status" className="sr-only">
      {state === 'copied'
        ? t('adminList.copied')
        : state === 'failed'
          ? t('adminList.copyFailed')
          : ''}
    </span>
  )
}

export const CopyIdButton = ({ id }: { readonly id: string }): ReactElement => {
  const { t } = useAdminPresentation()
  const { state, copy } = useCopyText()
  return (
    <>
      <button
        type="button"
        className="inline-grid h-11 w-8 shrink-0 place-items-center rounded-control text-muted hover:bg-surface-muted hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
        aria-label={t('adminList.copyId')}
        title={t('adminList.copyId')}
        onClick={() => copy(id)}
      >
        {state === 'copied' ? (
          <Icon name="check" className="size-4 text-success-strong" />
        ) : (
          <AdminListIcon name="copy" className="size-4" />
        )}
      </button>
      <CopyStatus state={state} />
    </>
  )
}
