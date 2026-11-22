import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'

/**
 * The red pen plays once right after submit; the state is dropped at once
 * so Back or reload show the finished marks.
 */
export const useGradingReveal = (): boolean => {
  const location = useLocation()
  const navigate = useNavigate()
  const [animateGrading] = useState(() =>
    Boolean(
      (location.state as { gradingReveal?: boolean } | null)?.gradingReveal
    )
  )
  useEffect(() => {
    if (!animateGrading) return
    void navigate(`${location.pathname}${location.search}`, {
      replace: true,
      state: null
    })
    // Run once on mount; the replaced entry keeps the same path.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return animateGrading
}
