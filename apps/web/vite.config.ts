import {
  createBrowserViteConfig,
  createSharedViteConfig
} from '../../packages/browser/vite.config.ts'

export const sharedViteConfig = createSharedViteConfig(import.meta.dirname)
export default createBrowserViteConfig(import.meta.dirname)
