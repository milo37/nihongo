import type { ReactElement } from 'react'

// #1055 the omikuji box and stick (design fe-spec: v4 props.cjs icon, v5
// look.cjs BOX and MOTION), drawn over Maru's approved poses from
// FoxSprite, which are used as they are. Colours are the sprite's own.
const LINE = 'var(--fox-line,#D99557)'
const CREAM = 'var(--fox-cream,#FEF4E8)'
const PEACH = 'var(--fox-body,#FDCD98)'
const RED = 'var(--maru-red,rgb(200,64,42))'
const FOX_BOX = '-6 -12 120 120'

/** A hexagonal box w wide, h tall, its top-left corner at x, y. */
const Box = ({
  x,
  y,
  w,
  h,
  hole = 0.1
}: {
  x: number
  y: number
  w: number
  h: number
  hole?: number
}) => {
  const s = w * 0.18
  const t = w * 0.24
  const rim = `M${x} ${y + t / 2}L${x + s} ${y}H${x + w - s}L${x + w} ${y + t / 2}`
  return (
    <g stroke={LINE} strokeWidth="2.2" strokeLinejoin="round">
      <path
        d={`${rim}V${y + h - 3}Q${x + w} ${y + h} ${x + w - 3} ${y + h}H${x + 3}Q${x} ${y + h} ${x} ${y + h - 3}Z`}
        fill={PEACH}
      />
      <path
        d={`M${x + s} ${y + t}H${x + w - s}V${y + h}H${x + s}Z`}
        fill={CREAM}
      />
      <path d={`${rim}L${x + w - s} ${y + t}H${x + s}Z`} fill={CREAM} />
      <path
        d={`M${x + s} ${y + t + w * 0.18}H${x + w - s}`}
        stroke={RED}
        strokeWidth="2.2"
      />
      <ellipse
        cx={x + w / 2}
        cy={y + t / 2}
        rx={w * hole}
        ry={t * 0.17}
        fill={LINE}
        stroke="none"
      />
    </g>
  )
}

/** The entry button's box with a stick standing out of it. */
export const OmikujiIcon = ({ size }: { size: number }): ReactElement => (
  <svg
    className="omikuji-icon"
    viewBox="0 0 40 40"
    width={size}
    height={size}
    aria-hidden="true"
  >
    <g
      transform="translate(23 3) rotate(12)"
      stroke={LINE}
      strokeWidth="1.6"
      strokeLinejoin="round"
    >
      <rect x="-1.8" width="3.6" height="14" rx="1" fill={CREAM} />
      <rect
        x="-1.8"
        y="10"
        width="3.6"
        height="4"
        rx="1"
        fill={RED}
        stroke={RED}
      />
    </g>
    <Box x={9} y={10} w={22} h={27} />
  </svg>
)

/** fox-lift holding the box over its head, with shake lines. */
export const OmikujiShake = (): ReactElement => (
  <svg className="omikuji-figure is-shake" viewBox={FOX_BOX} aria-hidden="true">
    <use href="#fox-lift" width="96" height="96" />
    <Box x={41} y={-6} w={36} h={42} />
    <g fill="none" stroke={LINE} strokeWidth="1.6" strokeLinecap="round">
      <path d="M80 8q4 6 0 12" />
      <path d="M85 5q5 9 0 18" />
      <path d="M38 8q-4 6 0 12" />
      <path d="M33 5q-5 9 0 18" />
    </g>
  </svg>
)

/**
 * fox-thud with the shake box brought down (design v5i, operator's pick):
 * the same box turned 8deg, a front paw on it and the stick sliding out
 * of the hole along the box's axis. Positions are the designer's paw.cjs.
 */
export const OmikujiLower = (): ReactElement => (
  <svg className="omikuji-figure is-lower" viewBox={FOX_BOX} aria-hidden="true">
    <use href="#fox-thud" width="96" height="96" />
    <g transform="rotate(8 74 77)">
      <Box x={56} y={60} w={36} h={42} />
      <clipPath id="omikuji-kuji-clip">
        <rect x="64" y="24.32" width="20" height="40" />
        <ellipse cx="74" cy="64.32" rx="3.8" ry="1.34" />
      </clipPath>
      <g clipPath="url(#omikuji-kuji-clip)">
        <g className="omikuji-kuji">
          <path
            d="M71.2 64.32V54.52Q71.2 53.32 72.4 53.32H75.6Q76.8 53.32 76.8 54.52V64.32A2.8 1.14 0 0 1 71.2 64.32Z"
            fill={CREAM}
            stroke={LINE}
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <path d="M72 55.92H76" stroke={RED} strokeWidth="2.4" />
        </g>
      </g>
    </g>
    <path
      transform="translate(60.6 72) rotate(-12)"
      d="M-5.6 -0.78C-5.6 -4.94 -2.52 -5.2 0 -4.68C3.08 -5.2 5.6 -4.16 5.6 -0.26C5.6 3.9 2.8 5.2 0 5.2C-3.36 5.2 -5.6 3.12 -5.6 -0.78Z"
      fill={CREAM}
      stroke={LINE}
      strokeWidth="2"
      strokeLinejoin="round"
    />
  </svg>
)

/** fox-yay, untouched, beside the slip. */
export const OmikujiYay = (): ReactElement => (
  <svg className="omikuji-yay" viewBox={FOX_BOX} aria-hidden="true">
    <use href="#fox-yay" width="96" height="96" />
  </svg>
)
