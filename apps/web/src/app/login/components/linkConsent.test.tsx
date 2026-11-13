import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { appI18n } from '@nihongo/browser/i18n/config'
import { linkConsent } from '@app/login/components/SignInCard'

const renderConsent = (text: string) =>
  render(
    <MemoryRouter>
      <p>{linkConsent(text)}</p>
    </MemoryRouter>
  ).container.querySelector('p') as HTMLElement

const links = (element: HTMLElement) =>
  [...element.querySelectorAll('a')].map(
    (link) => `${link.textContent}→${link.getAttribute('href')}`
  )

afterAll(async () => {
  await appI18n.changeLanguage('ko')
})

it.each([
  ['ko', ['이용약관→/legal#terms', '개인정보 처리방침→/legal#privacy']],
  ['ja', ['利用規約→/legal#terms', '個人情報処理方針→/legal#privacy']]
] as const)(
  'links both marks of the %s consent copy and shows no tag text',
  async (locale, expected) => {
    await appI18n.changeLanguage(locale)
    const element = renderConsent(appI18n.t('auth:sso.consentNotice'))
    expect(links(element)).toEqual(expected)
    expect(element.textContent).not.toMatch(/<\/?(?:terms|privacy)>/u)
  }
)

it('keeps text order when privacy comes first and drops a mark without its end', () => {
  const element = renderConsent(
    'A <privacy>P</privacy> B <terms>T</terms> C <terms>open'
  )
  expect(element.textContent).toBe('A P B T C open')
  expect(links(element)).toEqual(['P→/legal#privacy', 'T→/legal#terms'])
})

it('returns plain text unchanged', () => {
  expect(renderConsent('no marks here').textContent).toBe('no marks here')
})
