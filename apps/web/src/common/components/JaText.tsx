import { Fragment } from 'react'
import type { ReactElement } from 'react'
import { jaLineSegments } from '@common/libs/jaSpacing'

const INLINE = { display: 'inline' } as const

// WebKit will not break right after a nowrap piece, so a piece that ends a
// phrase (、。 or a closing bracket) gets an explicit break chance after it.
const ENDS_PHRASE = /[、。」』）】]\s*$/u

/**
 * Japanese text whose brackets and 。/、 stay with their neighbours on line
 * breaks (JLP-865). Renders inside the element that carries jaTextProps.
 */
export const JaText = ({ text }: { text: string }): ReactElement => (
  <>
    {jaLineSegments(text).map((segment, index) =>
      index % 2 === 1 ? (
        <Fragment key={index}>
          {/* Inline stated outright so name computation that cannot read the
              stylesheet (jsdom) does not split the words with spaces. */}
          <span className="whitespace-nowrap" style={INLINE}>
            {segment}
          </span>
          {ENDS_PHRASE.test(segment) ? <wbr style={INLINE} /> : null}
        </Fragment>
      ) : (
        segment
      )
    )}
  </>
)
