import { appI18n } from '@nihongo/browser/i18n/config'
import { getRouteLabelKey } from '@nihongo/browser/i18n/routePresentation'

describe('home route label (JLP-873)', () => {
  afterAll(async () => {
    await appI18n.changeLanguage('ko')
  })

  it('labels the guest home and the member home (/dashboard) as home', async () => {
    await appI18n.changeLanguage('ko')
    expect(getRouteLabelKey('/')).toBe('routes.home')
    // /dashboard is a member's home; it keeps its own key (report screen
    // 'dashboard') and only its label reads home.
    expect(getRouteLabelKey('/dashboard')).toBe('routes.dashboard')
    expect(appI18n.t('navigation:routes.home')).toBe('홈')
    expect(appI18n.t('navigation:routes.dashboard')).toBe('홈')
    await appI18n.changeLanguage('ja')
    expect(appI18n.t('navigation:routes.home')).toBe('ホーム')
    expect(appI18n.t('navigation:routes.dashboard')).toBe('ホーム')
    // The practice setup keeps its own label.
    expect(getRouteLabelKey('/practice')).toBe('routes.practiceSetup')
  })
})
