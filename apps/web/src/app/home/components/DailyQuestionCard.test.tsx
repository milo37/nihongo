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
import { dailyQuestionQueries } from '@app/home/queries/dailyQuestionQueries'

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
  // The plain sentence is never animated. Its class depends on today's mock
  // question (sr-only or narrow-only), so the check does not.
  const sentence = daily.querySelector('p[lang="ja"]')
  expect(sentence).not.toBeNull()
  expect(sentence?.closest('.home-daily-write')).toBeNull()
  expect(sentence?.querySelector('.home-daily-char')).toBeNull()

  fireEvent.pointerDown(document.body)
  for (const sheet of sheets(daily)) {
    expect(sheet).not.toHaveClass('home-daily-write')
  }
})

it('finishes by itself within about 1.6 seconds (#997)', async () => {
  renderCard()
  const daily = await findDaily()
  expect(sheets(daily)[0]).toHaveClass('home-daily-write')
  await waitFor(
    () => expect(sheets(daily)[0]).not.toHaveClass('home-daily-write'),
    { timeout: 2500 }
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

it('shows a question that fits only the wide sheet once on screen (#1036)', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  })
  const first = render(
    <QueryClientProvider client={client}>
      <DailyQuestionCard level="N5" />
    </QueryClientProvider>
  )
  await findDaily()
  first.unmount()
  // 40 squares: three rows of 15 fit, three rows of 12 do not.
  const key = dailyQuestionQueries.get('N5').queryKey
  const data = client.getQueryData(key)!
  client.setQueryData(key, {
    ...data,
    question: { ...data.question, questionText: 'あ'.repeat(40) }
  })
  render(
    <QueryClientProvider client={client}>
      <DailyQuestionCard level="N5" />
    </QueryClientProvider>
  )
  const daily = await findDaily()
  expect(daily.querySelector('.home-daily-sheet-wide')).not.toBeNull()
  expect(daily.querySelector('.home-daily-sheet-narrow')).toBeNull()
  // Shown only under 360px, where the wide sheet is hidden; read once.
  const sentences = daily.querySelectorAll('p[lang="ja"]')
  expect(sentences).toHaveLength(1)
  expect(sentences[0]).toHaveClass(
    'home-daily-question',
    'home-daily-question-narrow'
  )
  expect(sentences[0]).toHaveTextContent('あ'.repeat(40))
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
