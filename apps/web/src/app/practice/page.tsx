import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router'
import type { ReactElement } from 'react'
import type {
  JlptLevel,
  QuestionSubject,
  StudyMode
} from '@common/types/domain'
import { PracticeSetupForm } from '@app/practice/components/PracticeSetupForm'
import { ResumablePractice } from '@app/practice/components/ResumablePractice'
import { Button } from '@common/components/Button'
import { Dialog } from '@common/components/Dialog'
import { useCreateStudySession } from '@app/practice/hooks/useCreateStudySession'
import { useCancelStudySession } from '@app/practice/hooks/useCancelStudySession'
import { useListResumableStudySessions } from '@app/practice/hooks/useListResumableStudySessions'
import { getStudyDraftPrincipalScope } from '@app/practice/draft/studyDraftPrincipalScope'
import { assertCurrentCreateStudySessionAction } from '@app/practice/queries/studySessionQueries'
import { useAuth } from '@provider/ProtectedRouteProvider'
import { isAuthTransitionSupersededError } from '@libs/authTransitionFence'
import { useAppStore } from '@store/index'
import { isNoEligibleQuestionsApiError } from '@libs/apiError'

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

const getResumablePage = (value: string | null): number => {
  const page = Number(value)
  return Number.isSafeInteger(page) && page > 0 ? page : 1
}

const loginRequiredModes: readonly StudyMode[] = [
  'BOOKMARK',
  'DAILY_REVIEW',
  'WRONG_NOTE'
]

export const PracticePage = (): ReactElement => {
  const { t } = useTranslation('practice')
  const { t: homeT } = useTranslation('home')
  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { isReady, role, user } = useAuth()
  const beginPractice = useAppStore((state) => state.beginPractice)
  const storedSessionId = useAppStore((state) => state.sessionId)
  const [cancelSessionId, setCancelSessionId] = useState<string | null>(null)
  const resumableHeadingRef = useRef<HTMLHeadingElement>(null)
  const setupHeadingRef = useRef<HTMLHeadingElement>(null)
  const level = getInitialLevel(searchParams.get('level'))
  const subject = getInitialSubject(searchParams.get('subject'))
  const subjectLabel = homeT(
    subject === 'VOCABULARY'
      ? 'approved.vocabulary'
      : subject === 'GRAMMAR'
        ? 'subjects.grammar.label'
        : 'subjects.reading.label'
  )
  const startLabel = homeT('quickDrill.start', { level, subject: subjectLabel })
  const count = getInitialCount(searchParams.get('count'))
  const requestedMode = getRequestedMode(searchParams.get('mode'))
  const resumablePage = getResumablePage(searchParams.get('resumePage'))
  const updateSearchParam = useCallback(
    (
      key: 'count' | 'level' | 'mode' | 'resumePage' | 'subject',
      value: number | string,
      defaultValue: number | string,
      replace = false
    ): void => {
      const next = new URLSearchParams(searchParams)
      if (value === defaultValue) next.delete(key)
      else next.set(key, String(value))
      setSearchParams(next, { replace })
    },
    [searchParams, setSearchParams]
  )
  const getSearchParamHref = (
    key: 'count' | 'level' | 'mode' | 'resumePage' | 'subject',
    value: number | string,
    defaultValue: number | string
  ): string => {
    const next = new URLSearchParams(searchParams)
    if (value === defaultValue) next.delete(key)
    else next.set(key, String(value))
    return `?${next.toString()}`
  }
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
  const isResumableInteractionLocked =
    isResumableSourceUnavailable || resumableSessions.isFetching

  useEffect(() => {
    if (
      !resumableSessions.data ||
      resumableSessions.data.page !== resumablePage
    ) {
      return
    }
    if (resumablePage > resumablePageCount) {
      const timerId = window.setTimeout(() => {
        updateSearchParam('resumePage', resumablePageCount, 1, true)
      }, 0)
      return () => window.clearTimeout(timerId)
    }
  }, [
    resumablePage,
    resumablePageCount,
    resumableSessions.data,
    updateSearchParam
  ])

  useEffect(() => {
    if (resumableSessions.isError && !resumableSessions.data) {
      resumableHeadingRef.current?.focus()
    }
  }, [resumableSessions.data, resumableSessions.isError])

  const loginHref = `/login?redirect=${encodeURIComponent(`${location.pathname}${location.search}`)}`

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
    <section className="practice-setup-page">
      <ResumablePractice
        query={resumableSessions}
        canLoad={canLoadResumableSessions}
        storedSessionId={storedSessionId}
        requestedPage={resumablePage}
        pageCount={resumablePageCount}
        sourceUnavailable={isResumableSourceUnavailable}
        interactionLocked={isResumableInteractionLocked}
        headingRef={resumableHeadingRef}
        getPageHref={(page) => getSearchParamHref('resumePage', page, 1)}
        onPageChange={(page) => updateSearchParam('resumePage', page, 1)}
        onCancel={setCancelSessionId}
      />
      <div className="practice-setup-heading">
        <h1 ref={setupHeadingRef} tabIndex={-1}>
          {t('setup.title')}
        </h1>
      </div>
      <PracticeSetupForm
        level={level}
        subject={subject}
        count={count}
        mode={mode}
        levels={levels}
        subjects={subjects}
        counts={counts}
        modes={modes}
        isReady={isReady}
        isGuest={role === 'GUEST'}
        isCreating={isCreatingSession}
        isProtectedGuestMode={isProtectedGuestMode}
        subjectLabel={subjectLabel}
        startLabel={startLabel}
        loginHref={loginHref}
        onSubjectChange={(option) => {
          createSession.reset()
          updateSearchParam('subject', option, 'GRAMMAR')
        }}
        onLevelChange={(option) => {
          createSession.reset()
          updateSearchParam('level', option, 'N3')
        }}
        onCountChange={(option) => {
          createSession.reset()
          updateSearchParam('count', option, 10)
        }}
        onModeChange={(option) => {
          createSession.reset()
          updateSearchParam('mode', option, 'RANDOM')
        }}
        onStart={handleStart}
        feedback={
          <>
            {isProtectedGuestMode ? (
              <div
                className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950"
                role="alert"
              >
                {t('setup.protectedMode')}{' '}
                <Link
                  className="inline-flex min-h-11 items-center px-1 font-bold underline underline-offset-2 hover:no-underline"
                  to={loginHref}
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
                <p className="mt-1 leading-6">
                  {t('setup.noEligibleDescription')}
                </p>
                {mode !== 'RANDOM' ? (
                  <Button
                    className="mt-3"
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      createSession.reset()
                      updateSearchParam('mode', 'RANDOM', 'RANDOM')
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
          </>
        }
      />

      <Dialog
        open={cancelSessionId !== null}
        fallbackFocusRef={
          resumableSessions.data?.total === 0
            ? setupHeadingRef
            : resumableHeadingRef
        }
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
