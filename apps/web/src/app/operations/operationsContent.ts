export const operationsPages = {
  legal: {
    path: '/legal',
    sections: [
      { id: 'terms', key: 'terms' },
      { id: 'privacy', key: 'privacy' },
      { id: 'copyright', key: 'copyright' }
    ]
  },
  account: {
    path: '/account/data',
    sections: [
      { id: 'deletion', key: 'deletion' },
      { id: 'data-export', key: 'dataExport' }
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
  'account',
  'support'
] as const satisfies readonly OperationsInformationPageKind[]
