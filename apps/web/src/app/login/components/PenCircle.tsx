import type { ReactElement } from 'react'

// The teacher's red circle from the result score and the logo (#1046 시그니처):
// round the picked level and the switch knob when it is on.
const PEN_PATH =
  'M15.5 3.2C9 1.6 3 5.6 3.4 11.6c.4 5.6 7 8.4 12.2 6.2 4.6-2 5.6-7.6 2.4-11.4'

export const PenCircle = ({
  className
}: {
  className: string
}): ReactElement => (
  <svg
    className={className}
    viewBox="0 0 24 22"
    preserveAspectRatio="none"
    aria-hidden="true"
    focusable="false"
  >
    <path d={PEN_PATH} />
  </svg>
)
