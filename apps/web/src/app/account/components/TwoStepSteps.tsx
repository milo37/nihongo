import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import { Icon } from '@nihongo/browser/common/components/Icon'

const StepMarker = ({
  index,
  label,
  state,
  doneLabel
}: {
  index: number
  label: string
  state: 'done' | 'current' | 'upcoming'
  doneLabel: string
}): ReactElement => (
  <li
    className="two-step-step"
    aria-current={state === 'current' ? 'step' : undefined}
  >
    <span
      className={[
        'two-step-marker',
        state === 'done'
          ? 'two-step-marker-done'
          : state === 'current'
            ? 'two-step-marker-current'
            : 'two-step-marker-upcoming'
      ].join(' ')}
      aria-hidden="true"
    >
      {state === 'done' ? (
        <Icon name="check" className="two-step-check" />
      ) : (
        index
      )}
    </span>
    <span
      className={
        state === 'current' ? 'two-step-label-current' : 'two-step-label'
      }
    >
      {label}
      {state === 'done' ? <span className="sr-only"> {doneLabel}</span> : null}
    </span>
  </li>
)

/** ① verify with Google, ② confirm; the current step is marked. */
export const TwoStepSteps = ({
  isConfirm,
  isUnlink
}: {
  isConfirm: boolean
  isUnlink: boolean
}): ReactElement => {
  // Left uncompiled: the compiled dialog already caches this section
  // (#1124 bundle).
  'use no memo'
  const { t } = useTranslation('account')
  const { t: authT } = useTranslation('auth')
  return (
    <ol className="two-step-list">
      <StepMarker
        index={1}
        label={authT('reauth.name')}
        state={isConfirm ? 'done' : 'current'}
        doneLabel={authT('reauth.stepDone')}
      />
      <StepMarker
        index={2}
        label={t(isUnlink ? 'confirm.stepUnlink' : 'confirm.stepDelete')}
        state={isConfirm ? 'current' : 'upcoming'}
        doneLabel={authT('reauth.stepDone')}
      />
    </ol>
  )
}
