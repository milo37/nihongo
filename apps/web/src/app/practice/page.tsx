import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router'
import type { ReactElement } from 'react'
import type {
  JlptLevel,
  QuestionSubject,
  StudyMode
} from '@common/types/domain'
import { Button } from '@common/components/Button'
import { Dialog } from '@common/components/Dialog'
import { useCreateStudySession } from '@app/practice/hooks/useCreateStudySession'
import { useCancelStudySession } from '@app/practice/hooks/useCancelStudySession'
import { useListResumableStudySessions } from '@app/practice/hooks/useListResumableStudySessions'
import { getStudyDraftPrincipalScope } from '@app/practice/draft/studyDraftPrincipalScope'
import { assertCurrentCreateStudySessionAction } from '@app/practice/queries/studySessionQueries'
import { useAuth } from '@provider/ProtectedRouteProvider'
import { isAuthTransitionSupersededError } from '@libs/authTransitionFence'
import { formatDateTime, formatNumber } from '@libs/localeFormatters'
import { resolveUiLocale } from '@/i18n/types'
import { useAppStore } from '@store/index'
import { isNoEligibleQuestionsApiError } from '@util/apiError'

const levels: JlptLevel[] = ['N5', 'N4', 'N3', 'N2', 'N1']
const subjects: QuestionSubject[] = ['VOCABULARY', 'GRAMMAR', 'READING']
const counts = [5, 10, 20] as const
const modes: Array<{
  value: StudyMode
  requiresLogin: boolean
}> = [
  {
    value: 'RANDOM',
    requiresLogin: false
  },
  {
    value: 'WRONG_NOTE',
    requiresLogin: true
  },
  {
    value: 'WEAKNESS',
    requiresLogin: false
  },
  {
    value: 'BOOKMARK',
    requiresLogin: true
  },
  {
    value: 'DAILY_REVIEW',
    requiresLogin: true
  }
]

const getInitialLevel = (value: string | null): JlptLevel => {
  return levels.includes(value as JlptLevel) ? (value as JlptLevel) : 'N3'
}

const getInitialSubject = (value: string | null): QuestionSubject => {
  return subjects.includes(value as QuestionSubject)
    ? (value as QuestionSubject)
    : 'GRAMMAR'
}

const getInitialCount = (value: string | null): 5 | 10 | 20 => {
  const numberValue = Number(value)
  return counts.includes(numberValue as 5 | 10 | 20)
    ? (numberValue as 5 | 10 | 20)
    : 10
}

const getRequestedMode = (value: string | null): StudyMode => {
  const requested = modes.find((item) => item.value === value)
  return requested?.value ?? 'RANDOM'
}

const loginRequiredModes: readonly StudyMode[] = [
  'BOOKMARK',
  'DAILY_REVIEW',
  'WRONG_NOTE'
]

export const PracticePage = (): ReactElement => {
  const { i18n, t } = useTranslation('practice')
  const { t: commonT } = useTranslation('common')
  const locale = resolveUiLocale(i18n.resolvedLanguage)
  const formatCount = (value: number): string => formatNumber(value, locale)
  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { isReady, role, user } = useAuth()
  const beginPractice = useAppStore((state) => state.beginPractice)
  const storedSessionId = useAppStore((state) => state.sessionId)
  const [resumablePage, setResumablePage] = useState(1)
  const [cancelSessionId, setCancelSessionId] = useState<string | null>(null)
  const resumableHeadingRef = useRef<HTMLHeadingElement>(null)
  const [level, setLevel] = useState<JlptLevel>(() =>
    getInitialLevel(searchParams.get('level'))
  )
  const [subject, setSubject] = useState<QuestionSubject>(() =>
    getInitialSubject(searchParams.get('subject'))
  )
  const [count, setCount] = useState<5 | 10 | 20>(() =>
    getInitialCount(searchParams.get('count'))
  )
  const [requestedMode, setRequestedMode] = useState<StudyMode>(() =>
    getRequestedMode(searchParams.get('mode'))
  )
  const mode = requestedMode
  const isProtectedGuestMode =
    role === 'GUEST' && loginRequiredModes.includes(mode)
  const createSession = useCreateStudySession()
  const principalScope = getStudyDraftPrincipalScope(user)
  const canLoadResumableSessions =
    isReady && (user !== null || storedSessionId !== null)
  const resumableSessions = useListResumableStudySessions(
    resumablePage,
    5,
    canLoadResumableSessions
  )
  const resumablePageCount = resumableSessions.data
    ? Math.max(
        1,
        Math.ceil(
          resumableSessions.data.total / resumableSessions.data.pageSize
        )
      )
    : resumablePage
  const cancelSession = useCancelStudySession(principalScope)
  const isCreatingSession = createSession.isPending || createSession.isPaused
  const noEligibleQuestions =
    createSession.isError && isNoEligibleQuestionsApiError(createSession.error)
  const isResumableSourceUnavailable =
    resumableSessions.isError || resumableSessions.fetchStatus === 'paused'

  useEffect(() => {
    if (
      !resumableSessions.data ||
      resumableSessions.data.page !== resumablePage
    ) {
      return
    }
    if (resumablePage > resumablePageCount) {
      const timerId = window.setTimeout(() => {
        setResumablePage(resumablePageCount)
      }, 0)
      return () => window.clearTimeout(timerId)
    }
  }, [resumablePage, resumablePageCount, resumableSessions.data])

  const handleStart = (): void => {
    if (!isReady || isCreatingSession || isProtectedGuestMode) {
      return
    }

    createSession.mutate(
      { level, subject, count, mode },
      {
        onSuccess: ({ session }, input) => {
          assertCurrentCreateStudySessionAction(input)
          beginPractice(session.id, session.startedAt)
          void navigate(`/practice/session/${session.id}`)
        }
      }
    )
  }

  return (
    <section className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:py-16">
      <div className="flex flex-col gap-4 border-b border-line pb-8 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-black tracking-[0.16em] text-brand">
            {t('setup.eyebrow')}
          </p>
          <h1 className="mt-2 text-4xl font-black tracking-tight">
            {t('setup.title')}
          </h1>
          <p className="mt-3 text-muted">{t('setup.description')}</p>
        </div>
        <p className="text-sm font-semibold text-muted">
          {t('setup.currentRole', {
            role: commonT(`taxonomy.roles.${role}`)
          })}
        </p>
      </div>

      <section
        className="mt-8 rounded-2xl border border-line bg-slate-50 p-5 sm:p-6"
        aria-labelledby="resumable-practice-title"
      >
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2
              ref={resumableHeadingRef}
              id="resumable-practice-title"
              className="rounded-sm text-xl font-black focus-visible:outline focus-visible:outline-focus focus-visible:outline-offset-focus focus-visible:outline-brand"
              tabIndex={-1}
            >
              {t('setup.resume.title')}
            </h2>
            <p className="mt-1 text-sm leading-6 text-muted">
              {t('setup.resume.description')}
            </p>
          </div>
          {resumableSessions.isFetching && !resumableSessions.isPending ? (
            <span className="text-sm font-semibold text-muted" role="status">
              {t('setup.resume.refreshing')}
            </span>
          ) : null}
        </div>

        {canLoadResumableSessions &&
        resumableSessions.data &&
        isResumableSourceUnavailable ? (
          <div
            className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
            role={resumableSessions.isError ? 'alert' : 'status'}
          >
            <p className="font-semibold">
              {t(
                resumableSessions.fetchStatus === 'paused'
                  ? 'setup.resume.cachedOffline'
                  : 'setup.resume.stale'
              )}
            </p>
            {resumableSessions.isError ? (
              <Button
                className="mt-3"
                size="sm"
                variant="secondary"
                onClick={() => void resumableSessions.refetch()}
              >
                {commonT('actions.retry')}
              </Button>
            ) : null}
          </div>
        ) : null}

        {!canLoadResumableSessions ? (
          <p className="mt-4 rounded-lg border border-line bg-white p-4 text-sm leading-6 text-muted">
            {t('setup.resume.guestHint')}
          </p>
        ) : resumableSessions.isPending &&
          resumableSessions.fetchStatus === 'paused' ? (
          <p
            className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm font-semibold leading-6 text-amber-900"
            role="status"
          >
            {t('setup.resume.offline')}
          </p>
        ) : resumableSessions.isPending ? (
          <p className="mt-4 text-sm font-semibold text-muted" role="status">
            {t('setup.resume.loading')}
          </p>
        ) : resumableSessions.isError && !resumableSessions.data ? (
          <div
            className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900"
            role="alert"
          >
            <p>{t('setup.resume.error')}</p>
            <Button
              className="mt-3"
              size="sm"
              variant="secondary"
              onClick={() => void resumableSessions.refetch()}
            >
              {commonT('actions.retry')}
            </Button>
          </div>
        ) : resumableSessions.data.items.length === 0 ? (
          <p className="mt-4 rounded-lg border border-line bg-white p-4 text-sm leading-6 text-muted">
            {t('setup.resume.empty')}
          </p>
        ) : (
          <>
            <ul className="mt-4 grid gap-3 sm:grid-cols-2">
              {resumableSessions.data.items.map((item) => {
                const canResume =
                  item.resumeAvailability === 'SERVER' ||
                  storedSessionId === item.id
                return (
                  <li
                    key={item.id}
                    className="rounded-xl border border-line bg-white p-4"
                  >
                    <p className="font-black">
                      {item.level} ·{' '}
                      {commonT(`taxonomy.subjects.${item.subject}`)}
                    </p>
                    <p className="mt-1 text-xs font-black tracking-wide text-brand">
                      {t(`setup.modes.${item.mode}.label`)}
                    </p>
                    <p className="mt-1 text-sm leading-6 text-muted">
                      {t('setup.resume.summary', {
                        formattedCount: formatCount(item.actualCount),
                        formattedOrdinal: formatCount(item.currentOrdinal ?? 1),
                        formattedRevision: formatCount(item.draftRevision ?? 0)
                      })}
                    </p>
                    <p className="mt-1 text-xs font-semibold text-muted">
                      {item.draftSavedAt
                        ? t('setup.resume.lastSaved', {
                            date: formatDateTime(item.draftSavedAt, locale, {
                              dateStyle: 'medium',
                              timeStyle: 'short'
                            })
                          })
                        : t('setup.resume.notSaved')}
                    </p>
                    {item.resumeAvailability === 'LEGACY_LOCAL_ONLY' &&
                    !canResume ? (
                      <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm font-semibold leading-6 text-amber-900">
                        {t('setup.resume.legacyUnavailable')}
                      </p>
                    ) : null}
                    <div className="mt-4 flex flex-wrap gap-2">
                      {canResume ? (
                        <Link
                          className="inline-flex min-h-11 items-center justify-center rounded-lg bg-brand px-4 text-sm font-bold text-white hover:bg-emerald-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                          to={`/practice/session/${item.id}`}
                        >
                          {t('setup.resume.action')}
                        </Link>
                      ) : null}
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={isResumableSourceUnavailable}
                        onClick={() => setCancelSessionId(item.id)}
                      >
                        {t('setup.resume.cancel')}
                      </Button>
                    </div>
                  </li>
                )
              })}
            </ul>
            {resumableSessions.data.total > resumableSessions.data.pageSize ? (
              <nav
                className="mt-4 flex items-center justify-center gap-3"
                aria-label={t('setup.resume.paginationLabel')}
              >
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={isResumableSourceUnavailable || resumablePage === 1}
                  onClick={() => setResumablePage((page) => page - 1)}
                >
                  {commonT('pagination.previous')}
                </Button>
                <span className="text-sm font-bold">
                  {formatCount(resumablePage)} /{' '}
                  {formatCount(resumablePageCount)}
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={
                    isResumableSourceUnavailable ||
                    resumablePage >= resumablePageCount
                  }
                  onClick={() => setResumablePage((page) => page + 1)}
                >
                  {commonT('pagination.next')}
                </Button>
              </nav>
            ) : null}
          </>
        )}
      </section>

      <div className="mt-8 space-y-9 rounded-2xl border border-line bg-white p-5 shadow-soft sm:p-8">
        <fieldset disabled={isCreatingSession}>
          <legend className="text-lg font-black">
            {t('setup.steps.level')}
          </legend>
          <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-5">
            {levels.map((option) => (
              <button
                key={option}
                className="min-h-12 rounded-lg border border-line font-bold hover:border-slate-400 hover:bg-slate-50 data-[selected=true]:border-brand data-[selected=true]:bg-emerald-50 data-[selected=true]:text-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                type="button"
                aria-pressed={level === option}
                data-selected={level === option}
                onClick={() => {
                  createSession.reset()
                  setLevel(option)
                }}
              >
                {option}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset disabled={isCreatingSession}>
          <legend className="text-lg font-black">
            {t('setup.steps.subject')}
          </legend>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {subjects.map((option) => (
              <button
                key={option}
                className="min-h-12 rounded-lg border border-line px-4 font-bold hover:border-slate-400 hover:bg-slate-50 data-[selected=true]:border-brand data-[selected=true]:bg-emerald-50 data-[selected=true]:text-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                type="button"
                aria-pressed={subject === option}
                data-selected={subject === option}
                onClick={() => {
                  createSession.reset()
                  setSubject(option)
                }}
              >
                {commonT(`taxonomy.subjects.${option}`)}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset disabled={isCreatingSession}>
          <legend className="text-lg font-black">
            {t('setup.steps.count')}
          </legend>
          <div className="mt-4 grid grid-cols-3 gap-2">
            {counts.map((option) => (
              <button
                key={option}
                className="min-h-12 rounded-lg border border-line font-bold hover:border-slate-400 hover:bg-slate-50 data-[selected=true]:border-brand data-[selected=true]:bg-emerald-50 data-[selected=true]:text-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                type="button"
                aria-pressed={count === option}
                data-selected={count === option}
                onClick={() => {
                  createSession.reset()
                  setCount(option)
                }}
              >
                {t('setup.questionCount', {
                  formattedCount: formatCount(option)
                })}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset disabled={isCreatingSession}>
          <legend className="text-lg font-black">
            {t('setup.steps.mode')}
          </legend>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {modes.map((option) => {
              const disabled =
                !isReady || (option.requiresLogin && role === 'GUEST')
              return (
                <button
                  key={option.value}
                  className="min-h-24 rounded-xl border border-line p-4 text-left enabled:hover:border-slate-400 enabled:hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 data-[selected=true]:border-brand data-[selected=true]:bg-emerald-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                  type="button"
                  disabled={disabled}
                  aria-pressed={mode === option.value}
                  data-selected={mode === option.value}
                  onClick={() => {
                    createSession.reset()
                    setRequestedMode(option.value)
                  }}
                >
                  <strong className="block">
                    {t(`setup.modes.${option.value}.label`)}
                  </strong>
                  <span className="mt-1 block text-sm leading-6 text-muted">
                    {t(`setup.modes.${option.value}.description`)}
                  </span>
                  {disabled ? (
                    <span className="mt-1 block text-xs font-bold text-amber-700">
                      {t('setup.loginRequired')}
                    </span>
                  ) : null}
                </button>
              )
            })}
          </div>
        </fieldset>

        {isProtectedGuestMode ? (
          <div
            className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950"
            role="alert"
          >
            {t('setup.protectedMode')}{' '}
            <Link
              className="inline-flex min-h-11 items-center px-1 font-bold underline underline-offset-2 hover:no-underline"
              to={`/login?redirect=${encodeURIComponent(`${location.pathname}${location.search}`)}`}
            >
              {t('setup.login')}
            </Link>
          </div>
        ) : null}

        {noEligibleQuestions ? (
          <div
            className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"
            role="alert"
          >
            <p className="font-bold">
              {t('setup.noEligibleTitle', {
                mode: t(`setup.modes.${mode}.label`)
              })}
            </p>
            <p className="mt-1 leading-6">{t('setup.noEligibleDescription')}</p>
            {mode !== 'RANDOM' ? (
              <Button
                className="mt-3"
                size="sm"
                variant="secondary"
                onClick={() => {
                  createSession.reset()
                  setRequestedMode('RANDOM')
                }}
              >
                {t('setup.selectRandom')}
              </Button>
            ) : null}
          </div>
        ) : createSession.isError &&
          !isAuthTransitionSupersededError(createSession.error) ? (
          <div
            className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900"
            role="alert"
          >
            {t('setup.createError')}
          </div>
        ) : null}

        <div className="flex flex-col-reverse gap-3 border-t border-line pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted">
            {t('setup.authorityNote')}
            {role === 'GUEST' ? (
              <>
                {' '}
                <Link
                  className="inline-flex min-h-11 items-center px-1 font-bold text-brand underline hover:no-underline"
                  to={`/login?redirect=${encodeURIComponent(`${location.pathname}${location.search}`)}`}
                >
                  {t('setup.login')}
                </Link>
              </>
            ) : null}
          </p>
          <Button
            className="shrink-0"
            disabled={!isReady || isProtectedGuestMode}
            isLoading={isCreatingSession}
            size="lg"
            onClick={handleStart}
          >
            {t('setup.start')}
          </Button>
        </div>
      </div>

      <Dialog
        open={cancelSessionId !== null}
        fallbackFocusRef={resumableHeadingRef}
        title={t('setup.cancelDialog.title')}
        description={t('setup.cancelDialog.description')}
        footer={
          <>
            <Button
              variant="secondary"
              disabled={cancelSession.isPending}
              onClick={() => setCancelSessionId(null)}
            >
              {t('setup.cancelDialog.keep')}
            </Button>
            <Button
              isLoading={cancelSession.isPending}
              onClick={() => {
                if (!cancelSessionId) {
                  return
                }
                cancelSession.mutate(
                  { sessionId: cancelSessionId },
                  { onSuccess: () => setCancelSessionId(null) }
                )
              }}
            >
              {t('setup.cancelDialog.confirm')}
            </Button>
          </>
        }
        preventClose={cancelSession.isPending}
        onOpenChange={(open) => {
          if (!open && !cancelSession.isPending) {
            setCancelSessionId(null)
          }
        }}
      >
        {cancelSession.isError &&
        !isAuthTransitionSupersededError(cancelSession.error) ? (
          <p
            className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900"
            role="alert"
          >
            {t('setup.cancelDialog.error')}
          </p>
        ) : null}
      </Dialog>
    </section>
  )
}
