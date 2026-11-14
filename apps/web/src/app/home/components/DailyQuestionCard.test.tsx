import {
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cachedStorage } from '@nihongo/browser/libs/storage'
import { appI18n } from '@nihongo/browser/i18n/config'
import { DailyQuestionCard } from '@app/home/components/DailyQuestionCard'
import { dailyWriteIn } from '@app/home/dailyWriteIn'

const renderCard = () =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <DailyQuestionCard level="N5" />
    </QueryClientProvider>
  )

const findDaily = async () => {
  const daily = await screen.findByRole('region', { name: '오늘의 한 문제' })
  await within(daily).findAllByRole('button')
  return daily
}

const sheets = (daily: HTMLElement) =>
  Array.from(daily.querySelectorAll('.home-daily-sheet'))

beforeEach(async () => {
  await appI18n.changeLanguage('ko')
  dailyWriteIn.resetForTesting()
  cachedStorage.removeItem('harumaru:daily-answer:v1')
})

it('writes the question in on the first load and shows it whole on a press (#997)', async () => {
  renderCard()
  const daily = await findDaily()
  expect(sheets(daily).length).toBeGreaterThan(0)
  for (const sheet of sheets(daily)) {
    expect(sheet).toHaveClass('home-daily-write')
    const chars = Array.from(sheet.querySelectorAll('.home-daily-char'))
    expect(
      chars.map((char) => (char as SVGElement).style.getPropertyValue('--i'))
    ).toEqual(chars.map((_, index) => String(index)))
  }
  // The sentence for screen readers is never animated.
  expect(daily.querySelector('p[lang="ja"]')).toHaveClass('sr-only')

  fireEvent.pointerDown(document.body)
  for (const sheet of sheets(daily)) {
    expect(sheet).not.toHaveClass('home-daily-write')
  }
})

it('finishes by itself within a second (#997)', async () => {
  renderCard()
  const daily = await findDaily()
  expect(sheets(daily)[0]).toHaveClass('home-daily-write')
  await waitFor(
    () => expect(sheets(daily)[0]).not.toHaveClass('home-daily-write'),
    { timeout: 1500 }
  )
})

it('stays still when home opens again in the same page load (#997)', async () => {
  const first = renderCard()
  await findDaily()
  first.unmount()

  renderCard()
  const daily = await findDaily()
  for (const sheet of sheets(daily)) {
    expect(sheet).not.toHaveClass('home-daily-write')
  }
})

it('stays still on a day already answered (#997)', async () => {
  const first = renderCard()
  const daily = await findDaily()
  fireEvent.click(within(daily).getAllByRole('button')[0]!)
  first.unmount()

  dailyWriteIn.resetForTesting()
  renderCard()
  const reopened = await findDaily()
  for (const sheet of sheets(reopened)) {
    expect(sheet).not.toHaveClass('home-daily-write')
  }
})
