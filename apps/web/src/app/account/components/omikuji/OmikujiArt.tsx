import type { ReactElement } from 'react'

// #1055 the omikuji box and stick (design v4 props.cjs, v5 look.cjs and
// paw.cjs), drawn over Maru's approved poses from FoxSprite; Maru is never
// redrawn. Colours are the sprite's own.
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
 * fox-thud with the box held low and a stick sliding out of its hole; its
 * front paw is the same pose clipped and laid over the box (design v5f).
 * The operator is still choosing this picture (v6): swap this component
 * alone when the designer sends the final one.
 */
export const OmikujiLower = (): ReactElement => (
  <svg className="omikuji-figure is-lower" viewBox={FOX_BOX} aria-hidden="true">
    <use href="#fox-thud" width="96" height="96" />
    <g transform="rotate(8 74 77)">
      <Box x={56} y={60} w={36} h={34} />
    </g>
    <clipPath id="omikuji-stick">
      <rect y="-10" width="60" height="20" />
    </clipPath>
    <g transform="translate(75.77 64.44) rotate(-4.4)">
      <g clipPath="url(#omikuji-stick)">
        <g className="omikuji-stick">
          <rect
            x="-6"
            y="-1.4"
            width="31"
            height="2.8"
            rx="1"
            fill={CREAM}
            stroke={LINE}
            strokeWidth="1.5"
          />
          <path d="M22.4 -0.8v1.6" stroke={RED} strokeWidth="2.2" />
        </g>
      </g>
    </g>
    <ellipse
      transform="rotate(8 74 77)"
      cx="74"
      cy="64.32"
      rx="3.6"
      ry="1.47"
      fill={LINE}
    />
    <clipPath id="omikuji-paw">
      <ellipse cx="60.6" cy="72.6" rx="6" ry="6.25" />
    </clipPath>
    <use href="#fox-thud" width="96" height="96" clipPath="url(#omikuji-paw)" />
  </svg>
)

/** fox-yay, untouched, beside the slip. */
export const OmikujiYay = (): ReactElement => (
  <svg className="omikuji-yay" viewBox={FOX_BOX} aria-hidden="true">
    <use href="#fox-yay" width="96" height="96" />
  </svg>
)
