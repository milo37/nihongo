import { Fragment } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { jaLineSegments } from '@common/libs/jaSpacing'

const INLINE = { display: 'inline' } as const

// WebKit will not break right after a nowrap piece, so a piece that ends a
// phrase (、。 or a closing bracket) gets an explicit break chance after it.
const ENDS_PHRASE = /[、。」』）】]\s*$/u

/** #1182: a reading over text[from, to) (UTF-16 offsets, in order). */
export type JaRuby = {
  readonly from: number
  readonly to: number
  readonly reading: string
}

const Held = ({ children, text }: { children: ReactNode; text: string }) => (
  <>
    {/* Inline stated outright so name computation that cannot read the
        stylesheet (jsdom) does not split the words with spaces. */}
    <span className="whitespace-nowrap" style={INLINE}>
      {children}
    </span>
    {ENDS_PHRASE.test(text) ? <wbr style={INLINE} /> : null}
  </>
)

// The held pieces as ranges. A piece that cuts into a reading grows to hold
// the whole reading group, so a ruby never splits across two pieces.
const heldRanges = (
  text: string,
  ruby: readonly JaRuby[]
): Array<[number, number]> => {
  const ranges: Array<[number, number]> = []
  let at = 0
  jaLineSegments(text).forEach((segment, index) => {
    if (index % 2 === 1) {
      let from = at
      let to = at + segment.length
      for (const group of ruby) {
        if (group.from < to && group.to > from) {
          from = Math.min(from, group.from)
          to = Math.max(to, group.to)
        }
      }
      const last = ranges.at(-1)
      if (last && from < last[1]) last[1] = Math.max(last[1], to)
      else ranges.push([from, to])
    }
    at += segment.length
  })
  return ranges
}

/** #1183: the word being read aloud, text[from, to) (UTF-16 offsets). */
export type JaMark = { readonly from: number; readonly to: number }

// Plain text[from, to), with the part under the mark in its own span.
const marked = (
  text: string,
  from: number,
  to: number,
  mark: JaMark | undefined
): ReactNode[] => {
  if (!mark || mark.to <= from || mark.from >= to) return [text.slice(from, to)]
  const start = Math.max(from, mark.from)
  const end = Math.min(to, mark.to)
  return [
    text.slice(from, start),
    <span key={`mark-${start}`} className="study-read-mark">
      {text.slice(start, end)}
    </span>,
    text.slice(end, to)
  ].filter((node) => node !== '')
}

const withRuby = (
  text: string,
  from: number,
  to: number,
  ruby: readonly JaRuby[],
  mark: JaMark | undefined
): ReactNode[] => {
  const nodes: ReactNode[] = []
  let at = from
  for (const group of ruby) {
    if (group.from < from || group.to > to) continue
    if (group.from > at) nodes.push(...marked(text, at, group.from, mark))
    nodes.push(
      <ruby key={group.from}>
        {marked(text, group.from, group.to, mark)}
        <rt>{group.reading}</rt>
      </ruby>
    )
    at = group.to
  }
  if (at < to) nodes.push(...marked(text, at, to, mark))
  return nodes
}

const JaRubyText = ({
  mark,
  ruby,
  text
}: {
  mark: JaMark | undefined
  ruby: readonly JaRuby[]
  text: string
}): ReactElement => {
  const nodes: ReactNode[] = []
  let at = 0
  for (const [from, to] of heldRanges(text, ruby)) {
    nodes.push(...withRuby(text, at, from, ruby, mark))
    nodes.push(
      <Held key={`held-${from}`} text={text.slice(from, to)}>
        {withRuby(text, from, to, ruby, mark)}
      </Held>
    )
    at = to
  }
  nodes.push(...withRuby(text, at, text.length, ruby, mark))
  return <>{nodes}</>
}

/**
 * Japanese text whose brackets and 。/、 stay with their neighbours on line
 * breaks (JLP-865). Renders inside the element that carries jaTextProps.
 * With `ruby` (#1182) the readings sit over their groups; with `mark`
 * (#1183) the word being read aloud gets its own span.
 */
export const JaText = ({
  mark,
  ruby,
  text
}: {
  mark?: JaMark | undefined
  ruby?: readonly JaRuby[] | undefined
  text: string
}): ReactElement =>
  ruby?.length || mark ? (
    <JaRubyText mark={mark} ruby={ruby ?? []} text={text} />
  ) : (
    <>
      {jaLineSegments(text).map((segment, index) =>
        index % 2 === 1 ? (
          <Fragment key={index}>
            <Held text={segment}>{segment}</Held>
          </Fragment>
        ) : (
          segment
        )
      )}
    </>
  )
