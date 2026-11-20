import type { ReactElement } from 'react'
// Through the learn page module: the rush there draws Maru too, and one
// chunk for both keeps the bundle's file count (#1043).
import { FoxSprite } from '@app/practice/page'

// Maru's poses come from design's maru/fox.svg; after replacing it, run
// scripts/maru-sprite.mjs to regenerate FoxSprite.
const pose = (id: string): string => `#${id}`

/**
 * #1094 M-2a / C-6-6: Maru lifts the stamp, thuds it down, leaves the red
 * circle and cheers; about 1.3s, CSS only. Reduced motion: the cheering
 * still and the circle. Decoration only; the goal line carries the words.
 */
export const StampStage = (): ReactElement => (
  <div className="maru-stage" aria-hidden="true">
    <FoxSprite />
    <svg className="maru-ring" viewBox="0 0 24 22" focusable="false">
      <use href={pose('maru-ring')} />
    </svg>
    <svg className="maru-fox is-lift" viewBox="0 0 96 96" focusable="false">
      <use href={pose('fox-lift')} />
    </svg>
    <svg className="maru-fox is-thud" viewBox="0 0 96 96" focusable="false">
      <use href={pose('fox-thud')} />
    </svg>
    <svg className="maru-fox is-yay" viewBox="0 0 96 96" focusable="false">
      <use href={pose('fox-yay')} />
    </svg>
  </div>
)
