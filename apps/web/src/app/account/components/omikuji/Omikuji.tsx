import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import { FoxSprite } from '@app/practice/page'
import { useStudyGoal } from '@app/login/queries/studyGoalQueries'
import { EXPRESSIONS } from '@app/account/omikuji/omikujiData'
import { useOmikuji } from '@app/account/hooks/useOmikuji'
import {
  OmikujiIcon,
  OmikujiLower,
  OmikujiShake
} from '@app/account/components/omikuji/OmikujiArt'
import { OmikujiSlip } from '@app/account/components/omikuji/OmikujiSlip'

/**
 * #1055 today's omikuji (members only): a button by the stamp board's title
 * (or under the study goal row when there is no board) opens a bottom sheet
 * on phones and a 440px window from 1024px. The day's first draw plays
 * shake → lower → slip; reduced motion and later opens go straight to the
 * slip. Close: the 닫기 link, a click outside, Esc, or dragging the sheet
 * down; focus returns to the button.
 */
export const Omikuji = ({ userId }: { userId: string }): ReactElement => {
  const { t, i18n } = useTranslation('account')
  const {
    open,
    closing,
    phase,
    again,
    played,
    pressed,
    announce,
    drawn,
    date,
    pick,
    start,
    close,
    onDialogClose,
    sheetHandlers,
    dialogRef,
    sheetRef,
    titleRef,
    buttonRef
  } = useOmikuji(userId)
  const lang = i18n.language?.startsWith('ja') ? 'ja' : 'ko'
  const [, month, day] = date.split('-').map(Number)
  const item = EXPRESSIONS[pick.expressionIndex]!
  const spoken = t('omikuji.spoken', {
    fortune: pick.fortune.label,
    message: pick.fortune.messages[pick.messageIndex]![lang],
    expression: item.text,
    meaning: item.meaning[lang],
    example: item.example
  })
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`omikuji-button${pressed ? ' is-pressed' : ''}`}
        aria-label={t(drawn ? 'omikuji.view' : 'omikuji.draw')}
        onClick={start}
      >
        <OmikujiIcon size={44} />
        <span lang="ja">おみくじ</span>
      </button>
      <dialog
        ref={dialogRef}
        className={`omikuji-dialog${closing ? ' is-closing' : ''}`}
        aria-labelledby="omikuji-title"
        onCancel={(event) => {
          event.preventDefault()
          close()
        }}
        onClose={onDialogClose}
        onClick={(event) => {
          if (event.target === event.currentTarget) close()
        }}
      >
        {open ? (
          <div ref={sheetRef} className="omikuji-sheet" {...sheetHandlers}>
            <FoxSprite />
            <div className="omikuji-top">
              <h2 id="omikuji-title" ref={titleRef} tabIndex={-1}>
                {t('omikuji.heading', { month, day })}
              </h2>
              {phase === 'result' ? (
                <button type="button" className="omikuji-close" onClick={close}>
                  {t('omikuji.close')}
                </button>
              ) : null}
            </div>
            <div className="omikuji-body">
              {phase === 'result' && !played ? null : (
                <div
                  className={`omikuji-stage${phase === 'result' ? ' is-out' : ''}`}
                >
                  {phase === 'shake' ? <OmikujiShake /> : <OmikujiLower />}
                  <p className="omikuji-caption">
                    {phase === 'shake' ? t('omikuji.shaking') : null}
                  </p>
                </div>
              )}
              {phase === 'result' ? (
                <div className="omikuji-result">
                  <OmikujiSlip pick={pick} />
                  {again ? (
                    <p className="omikuji-again">{t('omikuji.again')}</p>
                  ) : null}
                </div>
              ) : null}
            </div>
            <p className="sr-only" aria-live="polite">
              {announce ? spoken : ''}
            </p>
          </div>
        ) : null}
      </dialog>
    </>
  )
}

/** With no daily goal there is no stamp board (JLP-948): the same button
 *  sits under the study goal row instead. */
export const OmikujiWithoutBoard = ({
  userId
}: {
  userId: string
}): ReactElement | null => {
  const goal = useStudyGoal(userId)
  if (goal === null || goal.dailyGoal != null) return null
  return (
    <div className="omikuji-row">
      <Omikuji userId={userId} />
    </div>
  )
}
