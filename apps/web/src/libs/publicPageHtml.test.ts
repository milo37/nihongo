import { describe, expect, it } from 'vitest'
import { renderPublicPageHtml } from '@nihongo/browser/libs/publicPageHtml'
import { publicPageHtmlList } from '@nihongo/browser/libs/publicPageSeo'

// The head of apps/web/index.html; the build stops if the real one drifts.
const indexHtml = `<!doctype html>
<html lang="ko">
  <head>
    <meta
      name="description"
      content="JLPT N5부터 N1까지 문제를 풀고 오답을 반복 학습하는 하루마루"
    />
    <meta property="og:title" content="하루마루" />
    <meta
      property="og:description"
      content="JLPT N5부터 N1까지 문제를 풀고 오답을 반복 학습하는 하루마루"
    />
    <meta property="og:url" content="https://harumaru.app/" />
    <meta property="og:locale" content="ko_KR" />
    <meta property="og:image" content="https://harumaru.app/share-card.png" />
    <title>하루마루</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/assets/index.js"></script>
  </body>
</html>
`

const alternates = [
  { hreflang: 'ko', href: 'https://harumaru.app/practice' },
  { hreflang: 'ja', href: 'https://harumaru.app/ja/practice' },
  { hreflang: 'x-default', href: 'https://harumaru.app/practice' }
]

describe('renderPublicPageHtml (#981, #1268)', () => {
  const html = renderPublicPageHtml(indexHtml, {
    path: '/ja/practice',
    locale: 'ja',
    title: '練習 | ハルまる',
    description: 'レベルと"科目" & セット',
    bodyHtml: '<h1>練習</h1>',
    alternates
  })

  it('writes the page title, description, share text and canonical', () => {
    expect(html).toContain('<title>練習 | ハルまる</title>')
    expect(html).toContain(
      '<link rel="canonical" href="https://harumaru.app/ja/practice" />'
    )
    expect(html).toContain(
      '<meta property="og:title" content="練習 | ハルまる" />'
    )
    expect(html).toContain(
      '<meta property="og:url" content="https://harumaru.app/ja/practice" />'
    )
    expect(html).toContain('<meta property="og:locale" content="ja_JP" />')
    expect(html.match(/レベルと&quot;科目&quot; &amp; セット/gu)).toHaveLength(
      2
    )
  })

  it('names the page language and its language alternates', () => {
    expect(html).toContain('<html lang="ja">')
    expect(html).toContain(
      '<link rel="alternate" data-prerender hreflang="ko" href="https://harumaru.app/practice" />'
    )
    expect(html).toContain(
      '<link rel="alternate" data-prerender hreflang="ja" href="https://harumaru.app/ja/practice" />'
    )
    expect(html).toContain(
      '<link rel="alternate" data-prerender hreflang="x-default" href="https://harumaru.app/practice" />'
    )
    expect(html).toContain(
      '<meta data-prerender name="nihongo-prerender" content="ja:/ja/practice" />'
    )
  })

  it('puts the page text in <noscript> and keeps scripts and the root', () => {
    expect(html).toContain(
      '<noscript><h1>練習</h1></noscript>\n    <div id="root"></div>'
    )
    expect(html).toContain('<script type="module" src="/assets/index.js">')
    expect(html).toContain('content="https://harumaru.app/share-card.png"')
    const marker = '<meta name="nihongo-release-id" content="release-fixture">'
    expect(
      renderPublicPageHtml(indexHtml.replace('</head>', `${marker}</head>`), {
        path: '/support',
        locale: 'ko',
        title: 't',
        description: 'd',
        bodyHtml: '',
        alternates: []
      })
    ).toContain(marker)
  })

  it('stops the build when index.html loses a tag it rewrites', () => {
    expect(() =>
      renderPublicPageHtml(indexHtml.replace(/<title>[^<]*<\/title>/u, ''), {
        path: '/legal',
        locale: 'ko',
        title: 't',
        description: 'd',
        bodyHtml: '',
        alternates: []
      })
    ).toThrow(/expected one/u)
  })
})

describe('publicPageHtmlList (#1268)', () => {
  const pages = publicPageHtmlList()

  it('lists the 8 public pages, Korean then Japanese', () => {
    expect(pages.map(({ path }) => path)).toEqual([
      '/',
      '/practice',
      '/legal',
      '/support',
      '/ja',
      '/ja/practice',
      '/ja/legal',
      '/ja/support'
    ])
  })

  it('gives every page its own title and description in its language', () => {
    expect(new Set(pages.map(({ title }) => title)).size).toBe(8)
    expect(new Set(pages.map(({ description }) => description)).size).toBe(8)
    for (const page of pages) {
      expect(/[぀-ヿ]/u.test(page.title)).toBe(page.locale === 'ja')
      expect(page.title.length).toBeLessThanOrEqual(40)
      expect(page.description.length).toBeLessThanOrEqual(130)
    }
  })

  it('links each pair with ko, ja and x-default, the same on both pages', () => {
    const [ko, ja] = [pages[1], pages[5]]
    expect(ko?.alternates).toEqual(ja?.alternates)
    expect(ko?.alternates).toEqual(alternates)
  })

  it('has real text for the page, and no listening or past-exam claims', () => {
    for (const page of pages) {
      expect(page.bodyHtml).toMatch(/^<h1>.+<\/h1><p>.+<\/p>/u)
      // The legal page's own sentence says the questions are not past exams.
      const text = `${page.title}${page.description}`
      expect(text).not.toMatch(/청해|聴解|기출|過去問/u)
    }
    expect(pages[0]?.bodyHtml).toContain(
      '<li>JLPT N3: 문자·어휘 · 문법 · 독해</li>'
    )
    expect(pages[4]?.bodyHtml).toContain(
      '<li>JLPT N3: 文字・語彙・文法・読解</li>'
    )
  })
  // #982
  it('writes WebSite and Organization JSON-LD on both home pages, in their language', () => {
    const expected = {
      ko: { name: '하루마루', home: 'https://harumaru.app/' },
      ja: { name: 'ハルまる', home: 'https://harumaru.app/ja' }
    } as const
    for (const page of pages) {
      const html = renderPublicPageHtml(indexHtml, page)
      if (page.path !== '/' && page.path !== '/ja') {
        expect(html).not.toContain('ld+json')
        continue
      }
      const blocks = [
        ...html.matchAll(
          /<script type="application\/ld\+json" data-prerender>(.*?)<\/script>/gu
        )
      ]
      expect(blocks).toHaveLength(1)
      const data = JSON.parse(blocks[0]?.[1] ?? '{}') as {
        '@context': string
        '@graph': Record<string, unknown>[]
      }
      expect(data['@context']).toBe('https://schema.org')
      const [site, organization] = data['@graph']
      const { name, home } = expected[page.locale]
      expect(site).toMatchObject({
        '@type': 'WebSite',
        name,
        url: home,
        inLanguage: page.locale
      })
      expect(organization).toMatchObject({
        '@type': 'Organization',
        name,
        logo: 'https://harumaru.app/icons/icon-512.png'
      })
      // Service name, addresses and logo only: no person, no mail address.
      expect(Object.keys(organization ?? {}).sort()).toEqual(
        ['@id', '@type', 'logo', 'name', 'url'].sort()
      )
      expect(blocks[0]?.[1]).not.toMatch(/@[a-z0-9-]+\.[a-z]|mailto|email/iu)
    }
  })

  it('keeps JSON-LD out of the page without data and escapes "<"', () => {
    const plain = renderPublicPageHtml(indexHtml, {
      ...pages[0]!,
      jsonLd: undefined
    })
    expect(plain).not.toContain('ld+json')
    const tricky = renderPublicPageHtml(indexHtml, {
      ...pages[0]!,
      jsonLd: { name: '</script><b>' }
    })
    expect(tricky.match(/<\/script>/gu)).toHaveLength(2)
  })
})
