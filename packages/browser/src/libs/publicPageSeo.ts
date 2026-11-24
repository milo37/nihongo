// #1268: what the build writes into the HTML of each public page (8 pages:
// /, /practice, /legal, /support and the same four under /ja). Build only:
// the app never imports this file, so it adds nothing to the bundle.
import { jaCoreResources } from '../i18n/resources/ja.ts'
import { koCoreResources } from '../i18n/resources/ko.ts'
import type { LocaleCatalog } from '../i18n/resources/ja.ts'
import type { UiLocale } from '../i18n/types.ts'
import { PUBLIC_PAGE_PATHS, toJapanesePath } from './publicPages.ts'
import type { PublicPagePath } from './publicPages.ts'
import { SITE_ORIGIN } from './publicPageHtml.ts'
import type { PublicPageHtml } from './publicPageHtml.ts'

const levels = ['N5', 'N4', 'N3', 'N2', 'N1'] as const
const subjects = ['VOCABULARY', 'GRAMMAR', 'READING'] as const

// Titles and descriptions follow the plan in #1268 (research/seo-1268-plan.md
// section 3). Only what the screens offer: three subjects, no listening.
const seo: Record<
  UiLocale,
  Record<PublicPagePath, { title: string; description: string }>
> = {
  ko: {
    '/': {
      title: 'JLPT 무료 문제, 하루 한 세트 | 하루마루',
      description:
        'JLPT N5부터 N1까지 문자·어휘, 문법, 독해 문제를 무료로 풀어 보세요. 가입 없이 바로 시작하고, 틀린 문제는 오답노트로 다시 풀 수 있어요.'
    },
    '/practice': {
      title: 'JLPT 급수별 문제 풀기 (N5~N1) | 하루마루',
      description:
        '급수와 과목을 고르면 짧은 한 세트가 바로 시작돼요. 문제마다 정답과 해설을 보여 주고, 가입 없이도 풀 수 있어요.'
    },
    '/legal': {
      title: '이용약관·개인정보 처리방침 | 하루마루',
      description:
        '하루마루 이용약관, 개인정보 처리방침, 문제 저작권 안내입니다.'
    },
    '/support': {
      title: '문제 신고·문의 | 하루마루',
      description:
        '문제의 오류를 알려 주시거나 하루마루 운영자에게 문의하는 방법을 안내합니다.'
    }
  },
  ja: {
    '/': {
      title: 'JLPT練習問題を無料で、1日1セット｜ハルまる',
      description:
        'JLPT N5〜N1の文字・語彙、文法、読解の問題を無料で解けます。登録なしですぐ始められ、間違えた問題は間違いノートで解き直せます。'
    },
    '/practice': {
      title: 'JLPTレベル別 問題演習（N5〜N1）｜ハルまる',
      description:
        'レベルと科目を選ぶと、短い1セットがすぐ始まります。問題ごとに正解と解説を表示し、登録しなくても解けます。'
    },
    '/legal': {
      title: '利用規約・個人情報処理方針｜ハルまる',
      description:
        'ハルまるの利用規約、個人情報処理方針、問題の著作権についてのご案内です。'
    },
    '/support': {
      title: '問題の報告・お問い合わせ｜ハルまる',
      description:
        '問題の誤りの報告や、ハルまる運営者へのお問い合わせ方法をご案内します。'
    }
  }
}

type Resources = LocaleCatalog<typeof koCoreResources>
const resources: Record<UiLocale, Resources> = {
  ko: koCoreResources,
  ja: jaCoreResources
}

const escapeText = (value: string): string =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

const pagePath = (locale: UiLocale, path: PublicPagePath): string =>
  locale === 'ja' ? toJapanesePath(path) : path

const levelList = (locale: UiLocale): string => {
  const subjectLabels = subjects
    .map((subject) => resources[locale].common.taxonomy.subjects[subject])
    .join(locale === 'ja' ? '・' : ' · ')
  return `<ul>${levels
    .map((level) => `<li>JLPT ${level}: ${escapeText(subjectLabels)}</li>`)
    .join('')}</ul>`
}

const pageBody = (locale: UiLocale, path: PublicPagePath): string => {
  const text = resources[locale]
  const { title, description } = seo[locale][path]
  const parts = [
    `<h1>${escapeText(title)}</h1>`,
    `<p>${escapeText(description)}</p>`
  ]
  if (path === '/' || path === '/practice') parts.push(levelList(locale))
  if (path === '/legal') {
    const { terms, privacy, copyright } = text.operations.sections
    parts.push(
      `<h2>${escapeText(terms.title)}</h2><p>${escapeText(terms.summary)}</p>`,
      `<h2>${escapeText(privacy.title)}</h2><p>${escapeText(privacy.summary)}</p>`,
      `<h2>${escapeText(copyright.title)}</h2><p>${escapeText(copyright.summary)}</p>`
    )
  }
  if (path === '/support') {
    const { questionReport, contact } = text.operations.sections
    parts.push(
      `<h2>${escapeText(questionReport.title)}</h2><p>${escapeText(questionReport.summary)}</p><p>${escapeText(questionReport.details)}</p>`,
      `<h2>${escapeText(contact.title)}</h2><p>${escapeText(contact.details)}</p>`
    )
  }
  // Links to the other public pages and to the other language.
  const other: UiLocale = locale === 'ko' ? 'ja' : 'ko'
  const links = PUBLIC_PAGE_PATHS.filter((target) => target !== path).map(
    (target) =>
      `<li><a href="${pagePath(locale, target)}">${escapeText(seo[locale][target].title)}</a></li>`
  )
  links.push(
    `<li><a href="${pagePath(other, path)}" hreflang="${other}" lang="${other}">${escapeText(text.common.locale[other])}</a></li>`
  )
  parts.push(`<nav><ul>${links.join('')}</ul></nav>`)
  return parts.join('')
}

// #982: WebSite and Organization in the page's own language. The service
// name, the addresses and the logo only: no person, no mail address.
const structuredData = (locale: UiLocale): Record<string, unknown> => {
  const name = resources[locale].common.appName
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        '@id': `${SITE_ORIGIN}/#website-${locale}`,
        url: `${SITE_ORIGIN}${pagePath(locale, '/')}`,
        name,
        inLanguage: locale,
        publisher: { '@id': `${SITE_ORIGIN}/#organization` }
      },
      {
        '@type': 'Organization',
        '@id': `${SITE_ORIGIN}/#organization`,
        name,
        url: `${SITE_ORIGIN}${pagePath(locale, '/')}`,
        logo: `${SITE_ORIGIN}/icons/icon-512.png`
      }
    ]
  }
}

/** All 8 public pages, ready for renderPublicPageHtml. */
export const publicPageHtmlList = (): PublicPageHtml[] =>
  (['ko', 'ja'] as const).flatMap((locale) =>
    PUBLIC_PAGE_PATHS.map((path) => ({
      path: pagePath(locale, path),
      locale,
      title: seo[locale][path].title,
      description: seo[locale][path].description,
      bodyHtml: pageBody(locale, path),
      // The home page of each language only: the site's own data, and the
      // 8-page copy would pass the total size budget of the built files.
      ...(path === '/' ? { jsonLd: structuredData(locale) } : {}),
      alternates: [
        { hreflang: 'ko', href: `${SITE_ORIGIN}${path}` },
        { hreflang: 'ja', href: `${SITE_ORIGIN}${toJapanesePath(path)}` },
        { hreflang: 'x-default', href: `${SITE_ORIGIN}${path}` }
      ]
    }))
  )
