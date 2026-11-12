import type { ReactElement } from 'react'
import { jaLineSegments } from '@common/libs/jaSpacing'

const INLINE = { display: 'inline' } as const

/**
 * Japanese text whose brackets and 。/、 stay with their neighbours on line
 * breaks (JLP-865). Renders inside the element that carries jaTextProps.
 */
export const JaText = ({ text }: { text: string }): ReactElement => (
  <>
    {jaLineSegments(text).map((segment, index) =>
      index % 2 === 1 ? (
        // Inline stated outright so name computation that cannot read the
        // stylesheet (jsdom) does not split the words with spaces.
        <span key={index} className="whitespace-nowrap" style={INLINE}>
          {segment}
        </span>
      ) : (
        segment
      )
    )}
  </>
)
