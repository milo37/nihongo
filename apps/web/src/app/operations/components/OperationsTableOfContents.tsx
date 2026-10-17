import { Link } from 'react-router'
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
}: OperationsTableOfContentsProps): ReactElement => (
  <nav
    className="operations-table-of-contents"
    aria-label={translate('navigation.tocLabel')}
  >
    <ul>
      {sections.map(({ id, key }) => (
        <li key={id}>
          <Link to={`#${id}`}>{translate(`sections.${key}.title`)}</Link>
        </li>
      ))}
    </ul>
  </nav>
)
