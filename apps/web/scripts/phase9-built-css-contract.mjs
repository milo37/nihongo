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

export const validateBuiltCssContract = (css) => {
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
