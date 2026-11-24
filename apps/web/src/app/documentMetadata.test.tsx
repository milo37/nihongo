import { renderHook } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import type { ReactNode } from 'react'
import { useDocumentMetadata } from '@nihongo/browser/common/hooks/useDocumentMetadata'
import { appI18n } from '@nihongo/browser/i18n/config'

// #1268: the build writes each public page's head tags into its HTML; the
// app keeps them on the first view of that page and takes over after that.
const render = async (path: string, language: 'ko' | 'ja') => {
  await appI18n.changeLanguage(language)
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>
  )
  return renderHook(() => useDocumentMetadata({ robots: 'index,follow' }), {
    wrapper
  })
}

const writeBuiltHead = (page: string): void => {
  document.head.innerHTML = `
    <title>SEO title</title>
    <meta name="description" content="SEO description" />
    <meta name="nihongo-prerender" content="${page}" />
    <link rel="canonical" href="https://harumaru.app/ja/practice" />
    <link rel="alternate" hreflang="ko" href="https://harumaru.app/practice" />
    <link rel="alternate" hreflang="ja" href="https://harumaru.app/ja/practice" />`
}

afterEach(() => {
  document.head.innerHTML = ''
})

it('keeps the built head on the first view of that page and language', async () => {
  writeBuiltHead('ja:/ja/practice')
  await render('/ja/practice', 'ja')
  expect(document.title).toBe('SEO title')
  expect(
    document.querySelector('meta[name="description"]')?.getAttribute('content')
  ).toBe('SEO description')
  expect(document.querySelectorAll('link[rel="alternate"]')).toHaveLength(2)
  // The robots tag is not in the built HTML; the app still adds it.
  expect(
    document.querySelector('meta[name="robots"]')?.getAttribute('content')
  ).toBe('index,follow')
})

it('takes over, and drops the language links, on another page', async () => {
  writeBuiltHead('ja:/ja')
  await render('/ja/practice', 'ja')
  expect(document.title).toBe(
    `${appI18n.t('navigation:routes.practiceSetup')} | ハルまる`
  )
  expect(document.querySelectorAll('link[rel="alternate"]')).toHaveLength(0)
  expect(
    document.querySelector('link[rel="canonical"]')?.getAttribute('href')
  ).toBe(`${window.location.origin}/ja/practice`)
})

it('takes over when the visitor reads another language than the page', async () => {
  writeBuiltHead('ko:/practice')
  await render('/practice', 'ja')
  expect(document.title).toContain('ハルまる')
  expect(document.querySelectorAll('link[rel="alternate"]')).toHaveLength(0)
})
