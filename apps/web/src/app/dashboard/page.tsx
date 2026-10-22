import { Navigate, useSearchParams } from 'react-router'
import type { ReactElement } from 'react'
import { PracticePage } from '@app/practice/page'
import { LearningEntry } from '@app/dashboard/components/LearningEntry'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@provider/ProtectedRouteProvider'

export const LearningHomePage = (): ReactElement => {
  const { t } = useTranslation('home')
  const { user } = useAuth()
  return (
    <PracticePage>
      <details className="practice-recommendations">
        <summary>{t('entry.additionalOptions')}</summary>
        <LearningEntry key={user?.id ?? 'guest'} isMember={user !== null} />
      </details>
    </PracticePage>
  )
}

export const DashboardPage = (): ReactElement => {
  const [searchParams] = useSearchParams()
  return searchParams.get('view') === 'learning' ? (
    <LearningHomePage />
  ) : (
    <Navigate replace to="/wrong-notes" />
  )
}
