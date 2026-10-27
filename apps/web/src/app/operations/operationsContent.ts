export const operationsPages = {
  legal: {
    path: '/legal',
    sections: [
      { id: 'terms', key: 'terms' },
      { id: 'privacy', key: 'privacy' },
      { id: 'copyright', key: 'copyright' }
    ]
  },
  support: {
    path: '/support',
    sections: [
      { id: 'question-report', key: 'questionReport' },
      { id: 'contact', key: 'contact' }
    ]
  }
} as const

export type OperationsInformationPageKind = keyof typeof operationsPages

export type OperationsInformationSection =
  (typeof operationsPages)[OperationsInformationPageKind]['sections'][number]

export const operationsPageKinds = [
  'legal',
  'support'
] as const satisfies readonly OperationsInformationPageKind[]

export const operationsNavigationLinks = [
  { to: operationsPages.legal.path, key: 'legal' },
  { to: '/account/data', key: 'account' },
  { to: operationsPages.support.path, key: 'support' }
] as const
