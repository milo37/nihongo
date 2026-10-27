import { Link, useLocation } from 'react-router'
import type { TFunction } from 'i18next'
import type { ReactElement } from 'react'
import type { OperationsInformationSection } from '@app/operations/operationsContent'

type OperationsTableOfContentsProps = {
  sections: readonly OperationsInformationSection[]
  translate: TFunction<'operations'>
}

export const OperationsTableOfContents = ({
  sections,
  translate
}: OperationsTableOfContentsProps): ReactElement => {
  const { hash } = useLocation()

  return (
    <nav
      className="operations-table-of-contents"
      aria-label={translate('navigation.tocLabel')}
    >
      <ul>
        {sections.map(({ id, key }) => (
          <li key={id}>
            <Link
              to={`#${id}`}
              onClick={(event) => {
                if (
                  event.defaultPrevented ||
                  event.button !== 0 ||
                  event.metaKey ||
                  event.ctrlKey ||
                  event.shiftKey ||
                  event.altKey ||
                  hash !== `#${id}`
                ) {
                  return
                }
                const target = document.getElementById(id)
                if (!target) return
                event.preventDefault()
                target.focus({ preventScroll: true })
                target.scrollIntoView({ block: 'start' })
              }}
            >
              {translate(`sections.${key}.title`)}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
