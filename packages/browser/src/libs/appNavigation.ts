import { useCallback } from 'react'
import { createPath, useHref, useNavigate } from 'react-router'
import type { NavigateOptions, To } from 'react-router'

const isAdminPath = (path: string): boolean =>
  path === '/admin' ||
  path.startsWith('/admin/') ||
  path.startsWith('/admin?') ||
  path.startsWith('/admin#')

export const getAppPath = (path: string, basename: string): string => {
  const base = basename.replace(/\/$/u, '')
  return base && path.startsWith('/') && !isAdminPath(path) ? base + path : path
}

export const resolveAppDestination = (
  path: string,
  basename: string
): { crossApplication: boolean; path: string } => {
  if (!path.startsWith('/') || path.startsWith('//'))
    return { crossApplication: false, path }
  const admin = basename.replace(/\/$/u, '') === '/admin'
  const targetAdmin = isAdminPath(path)
  return {
    crossApplication: admin !== targetAdmin,
    path: admin && targetAdmin ? path.slice('/admin'.length) || '/' : path
  }
}

export const appDocumentNavigation = {
  assign: (url: string): void => window.location.assign(url),
  replace: (url: string, state?: unknown): void => {
    if (state === undefined) {
      window.location.replace(url)
      return
    }
    // Preserve the existing router notice across the document boundary, with no new persisted auth state.
    window.history.replaceState(
      { ...window.history.state, usr: state },
      '',
      url
    )
    window.location.reload()
  }
}

export const useAppNavigate = () => {
  const navigate = useNavigate()
  const basename = useHref('/')
  return useCallback(
    (to: To, options?: NavigateOptions): void | Promise<void> => {
      const path = typeof to === 'string' ? to : createPath(to)
      const destination = resolveAppDestination(path, basename)
      if (destination.crossApplication) {
        if (options?.replace) appDocumentNavigation.replace(path, options.state)
        else appDocumentNavigation.assign(path)
        return
      }
      return navigate(
        typeof to === 'string'
          ? destination.path
          : { ...to, pathname: destination.path.split(/[?#]/u)[0] },
        options
      )
    },
    [basename, navigate]
  )
}
