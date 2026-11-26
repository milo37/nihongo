import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject
} from 'react'

export interface ChartBox {
  readonly width: number
  readonly height: number
}

/** Size used before the first measure (and where ResizeObserver is missing). */
const FALLBACK_BOX: ChartBox = { width: 640, height: 200 }

/**
 * #1271 chart sizing and pointing. The SVG draws in its own CSS pixels so axis
 * text stays its real size; the day under the pointer opens the tooltip. A
 * mouse leaving closes it; on touch it stays until a press outside the chart.
 */
export const useChartPointer = ({
  dayCount,
  plotLeft,
  plotRight
}: {
  dayCount: number
  plotLeft: number
  plotRight: number
}): {
  frameRef: RefObject<HTMLDivElement | null>
  svgRef: RefObject<SVGSVGElement | null>
  box: ChartBox
  active: number | null
  onPointer: (event: ReactPointerEvent<SVGSVGElement>) => void
  onLeave: (event: ReactPointerEvent<SVGSVGElement>) => void
} => {
  const frameRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [box, setBox] = useState<ChartBox>(FALLBACK_BOX)
  const [active, setActive] = useState<number | null>(null)

  useEffect(() => {
    const svg = svgRef.current
    if (!svg || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      const { width, height } = entry.contentRect
      if (width > 0 && height > 0) setBox({ width, height })
    })
    observer.observe(svg)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (active === null) return
    const close = (event: PointerEvent) => {
      if (!frameRef.current?.contains(event.target as Node)) setActive(null)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [active])

  const onPointer = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (dayCount === 0) return
    const rect = event.currentTarget.getBoundingClientRect()
    const plotWidth = rect.width - plotLeft - plotRight
    const share =
      plotWidth > 0 ? (event.clientX - rect.left - plotLeft) / plotWidth : 0
    const day = Math.round(share * (dayCount - 1))
    setActive(Math.min(dayCount - 1, Math.max(0, day)))
  }

  const onLeave = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.pointerType === 'mouse') setActive(null)
  }

  return { frameRef, svgRef, box, active, onPointer, onLeave }
}
