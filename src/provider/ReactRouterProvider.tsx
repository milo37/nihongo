import { RouterProvider } from 'react-router'
import type { ReactElement } from 'react'
import { router } from '@/router'

export const ReactRouterProvider = (): ReactElement => {
  return <RouterProvider router={router} />
}
