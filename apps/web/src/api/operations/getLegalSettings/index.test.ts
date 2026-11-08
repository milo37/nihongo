import { http, HttpResponse } from 'msw'
import {
  getLegalSettings,
  LEGAL_SETTINGS_PATH
} from '@api/operations/getLegalSettings'
import { operationsQueries } from '@app/operations/queries/operationsQueries'
import { mockServer } from '@/test/server'

const getLegalSettingsOrEmpty = operationsQueries.legalSettings()
  .queryFn as () => Promise<unknown>

const empty = { contactEmail: '', privacyOfficer: '' }

describe('legal runtime settings', () => {
  it('reads the deploy values', async () => {
    mockServer.use(
      http.get(LEGAL_SETTINGS_PATH, () =>
        HttpResponse.json({
          contactEmail: ' help@example.com ',
          privacyOfficer: '홍길동'
        })
      )
    )
    await expect(getLegalSettings()).resolves.toEqual({
      contactEmail: 'help@example.com',
      privacyOfficer: '홍길동'
    })
  })

  it('falls back to empty values without a usable file', async () => {
    await expect(getLegalSettingsOrEmpty()).resolves.toEqual(empty)
    mockServer.use(
      http.get(
        LEGAL_SETTINGS_PATH,
        () => new HttpResponse('<!doctype html>', { status: 200 })
      )
    )
    await expect(getLegalSettingsOrEmpty()).resolves.toEqual(empty)
    mockServer.use(
      http.get(LEGAL_SETTINGS_PATH, () =>
        HttpResponse.json({ contactEmail: 3, privacyOfficer: 'x'.repeat(201) })
      )
    )
    await expect(getLegalSettings()).resolves.toEqual(empty)
    mockServer.use(http.get(LEGAL_SETTINGS_PATH, () => HttpResponse.json([])))
    await expect(getLegalSettings()).resolves.toEqual(empty)
  })
})
