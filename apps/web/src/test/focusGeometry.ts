export interface FocusGeometryEvidence {
  readonly bottom: number
  readonly headerBottom: number
  readonly height: number
  readonly insideHeader: boolean
  readonly isNamedScrollHost: boolean
  readonly left: number
  readonly right: number
  readonly top: number
  readonly viewportHeight: number
  readonly viewportWidth: number
  readonly width: number
}

export const isFocusedElementUnobscured = (
  geometry: FocusGeometryEvidence
): boolean => {
  const topBoundary = geometry.insideHeader ? 0 : geometry.headerBottom
  const fitsVertically =
    geometry.height <= geometry.viewportHeight - topBoundary + 2
  const fitsHorizontally = geometry.width <= geometry.viewportWidth + 2
  const requiresPartialVisibilityException =
    !fitsVertically || !fitsHorizontally

  if (requiresPartialVisibilityException && !geometry.isNamedScrollHost) {
    return false
  }

  return (
    geometry.top >= topBoundary - 1 &&
    (fitsVertically
      ? geometry.bottom <= geometry.viewportHeight + 1
      : geometry.top < geometry.viewportHeight) &&
    geometry.left >= -1 &&
    (fitsHorizontally
      ? geometry.right <= geometry.viewportWidth + 1
      : geometry.left < geometry.viewportWidth)
  )
}
