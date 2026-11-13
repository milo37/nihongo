const extractBalancedBlocks = (source, marker) => {
  const blocks = []
  let searchFrom = 0

  while (searchFrom < source.length) {
    const remaining = source.slice(searchFrom)
    const match = marker.exec(remaining)
    if (!match || match.index === undefined) break

    const markerIndex = searchFrom + match.index
    const start = source.indexOf('{', markerIndex)
    if (start < 0) break

    let depth = 0
    let closed = false
    for (let index = start; index < source.length; index += 1) {
      if (source[index] === '{') depth += 1
      if (source[index] === '}') depth -= 1
      if (depth === 0) {
        blocks.push(source.slice(start + 1, index))
        searchFrom = index + 1
        closed = true
        break
      }
    }
    if (!closed) break
  }

  return blocks
}

const removeBalancedBlocks = (source, marker) => {
  let result = source
  for (;;) {
    const match = marker.exec(result)
    if (!match || match.index === undefined) return result
    const start = result.indexOf('{', match.index)
    if (start < 0) return result
    let depth = 0
    let end = -1
    for (let index = start; index < result.length; index += 1) {
      if (result[index] === '{') depth += 1
      if (result[index] === '}') depth -= 1
      if (depth === 0) {
        end = index
        break
      }
    }
    if (end < 0) return result
    result = result.slice(0, match.index) + result.slice(end + 1)
  }
}

const reducedMotionMarker = /@media\s*\(prefers-reduced-motion:\s*reduce\)/iu

// JLP-870: the minifier turned a shorthand with no animation name
// ('animation: 300ms ... both') into 'animation:none' and the question push
// vanished in production. Only reduced motion may switch an animation off.
const validateAnimations = (css) => {
  const motionCss = removeBalancedBlocks(css, reducedMotionMarker)
  if (/animation:\s*none/iu.test(motionCss)) {
    throw new Error(
      'Built CSS switches an animation off outside reduced motion (a shorthand with no name?)'
    )
  }

  const pushRules = [
    ...motionCss.matchAll(/\.study-push\[data-push\]\s*\{([^}]*)\}/giu)
  ].map((match) => match[1])
  if (
    !pushRules.some((rule) =>
      /animation-duration:\s*(?:0?\.3s|300ms)/iu.test(rule)
    )
  ) {
    throw new Error('Built CSS lost the 300ms question push duration')
  }

  const reducedMotionBlocks = extractBalancedBlocks(css, reducedMotionMarker)
  if (
    !reducedMotionBlocks.some((block) =>
      /\.study-push\[data-push\]\s*\{[^}]*animation:\s*none/iu.test(block)
    )
  ) {
    throw new Error(
      'Built CSS no longer stops the question push for reduced motion'
    )
  }
}

export const validateBuiltCssContract = (css) => {
  validateAnimations(css)

  if (!/\.ui-tab\s*\{[^}]*border-block-end:/u.test(css)) {
    throw new Error('Built CSS is missing the shared tab selection indicator')
  }

  const forcedColorBlocks = extractBalancedBlocks(
    css,
    /@media\s*\(forced-colors:\s*active\)/iu
  )
  const hasSelectedTabRule = forcedColorBlocks.some((block) => {
    const selectedRule = block.match(
      /\.ui-tab\[aria-selected=['"]?true['"]?\]\s*\{([^}]*)\}/iu
    )?.[1]

    return (
      selectedRule !== undefined &&
      /border-block-end-color:\s*highlight/iu.test(selectedRule) &&
      /forced-color-adjust:\s*auto/iu.test(selectedRule)
    )
  })

  if (!hasSelectedTabRule) {
    throw new Error('Built CSS is missing the forced-colors selected-tab rule')
  }

  const hasAnsweredQuestionRule = forcedColorBlocks.some((block) => {
    const answeredRule = block.match(
      /\.ui-question-jump\[data-answered=['"]?true['"]?\]\s*\{([^}]*)\}/iu
    )?.[1]

    return (
      answeredRule !== undefined &&
      /border-style:\s*double/iu.test(answeredRule) &&
      /forced-color-adjust:\s*auto/iu.test(answeredRule)
    )
  })

  if (!hasAnsweredQuestionRule) {
    throw new Error(
      'Built CSS is missing the forced-colors answered-question indicator'
    )
  }
}
