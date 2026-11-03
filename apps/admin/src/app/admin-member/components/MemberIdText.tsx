import { Fragment } from 'react'
import type { ReactElement } from 'react'

/** Full UUID that wraps only after its hyphen groups, never mid-group. */
export const MemberIdText = ({
  memberId
}: {
  readonly memberId: string
}): ReactElement => (
  <>
    {memberId.split('-').map((group, index) => (
      <Fragment key={index}>
        {index > 0 ? (
          <>
            -<wbr />
          </>
        ) : null}
        <span className="whitespace-nowrap">{group}</span>
      </Fragment>
    ))}
  </>
)
