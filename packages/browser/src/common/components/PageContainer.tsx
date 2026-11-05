import type { ReactElement, ReactNode } from 'react'

const widthClassName = { '5xl': 'max-w-5xl', '6xl': 'max-w-6xl' } as const

type PageContainerProps = {
  width: keyof typeof widthClassName
  children: ReactNode
}

/** Centered page section with the standard admin page padding. */
export const PageContainer = ({
  width,
  children
}: PageContainerProps): ReactElement => (
  <section
    className={`mx-auto w-full ${widthClassName[width]} px-4 py-10 sm:px-6 sm:py-14`}
  >
    {children}
  </section>
)
