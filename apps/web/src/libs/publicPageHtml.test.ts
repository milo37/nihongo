import { describe, expect, it } from 'vitest'
import { renderPublicPageHtml } from '@nihongo/browser/libs/publicPageHtml'

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
    <meta property="og:image" content="https://harumaru.app/share-card.png" />
    <title>하루마루</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/assets/index.js"></script>
  </body>
</html>
`

describe('renderPublicPageHtml (#981)', () => {
  const html = renderPublicPageHtml(indexHtml, {
    path: '/practice',
    title: '학습 | 하루마루',
    description: '급수와 "과목" & 세트'
  })

  it('writes the page title, description, share text and canonical', () => {
    expect(html).toContain('<title>학습 | 하루마루</title>')
    expect(html).toContain(
      '<link rel="canonical" href="https://harumaru.app/practice" />'
    )
    expect(html).toContain(
      '<meta property="og:title" content="학습 | 하루마루" />'
    )
    expect(html).toContain(
      '<meta property="og:url" content="https://harumaru.app/practice" />'
    )
    expect(html.match(/급수와 &quot;과목&quot; &amp; 세트/gu)).toHaveLength(2)
  })

  it('keeps the body, scripts, share card and release marker unchanged', () => {
    const body = (source: string) => source.slice(source.indexOf('<body>'))
    expect(body(html)).toBe(body(indexHtml))
    expect(html).toContain('content="https://harumaru.app/share-card.png"')
    const marker = '<meta name="nihongo-release-id" content="release-fixture">'
    expect(
      renderPublicPageHtml(indexHtml.replace('</head>', `${marker}</head>`), {
        path: '/support',
        title: 't',
        description: 'd'
      })
    ).toContain(marker)
  })

  it('stops the build when index.html loses a tag it rewrites', () => {
    expect(() =>
      renderPublicPageHtml(indexHtml.replace(/<title>[^<]*<\/title>/u, ''), {
        path: '/legal',
        title: 't',
        description: 'd'
      })
    ).toThrow(/expected one/u)
  })
})
