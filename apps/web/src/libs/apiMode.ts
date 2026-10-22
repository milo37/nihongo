export type ApiMode = 'mock' | 'real'

const assertRuntimeApiMode = (): ApiMode => {
  if (__NIHONGO_API_MODE__ !== 'mock' && __NIHONGO_API_MODE__ !== 'real') {
    throw new Error('The resolved API mode is invalid.')
  }

  if (__NIHONGO_PRODUCTION_BUILD__ && __NIHONGO_API_MODE__ === 'mock') {
    throw new Error('Mock API mode is forbidden in a production build.')
  }

  return __NIHONGO_API_MODE__
}

export const apiMode = assertRuntimeApiMode()
export const isMockApiMode = __NIHONGO_API_MODE__ === 'mock'
export const isRealApiMode = __NIHONGO_API_MODE__ === 'real'
