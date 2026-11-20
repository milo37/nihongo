import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import { EXPRESSIONS } from '@app/account/omikuji/omikujiData'
import type { OmikujiPick } from '@app/account/omikuji/pickOmikuji'
import { OmikujiYay } from '@app/account/components/omikuji/OmikujiArt'

/**
 * #1055 the slip (design v5 result A): a thin red band on top, the fortune
 * big in ink with no gloss under it, today's message, then today's
 * expression; Maru (fox-yay) sits at its lower right. 凶 looks the same.
 */
export const OmikujiSlip = ({ pick }: { pick: OmikujiPick }): ReactElement => {
  const { t, i18n } = useTranslation('account')
  const lang = i18n.language?.startsWith('ja') ? 'ja' : 'ko'
  const message = pick.fortune.messages[pick.messageIndex]!
  const item = EXPRESSIONS[pick.expressionIndex]!
  return (
    <div className="omikuji-slip-wrap">
      <div className="omikuji-slip">
        <p className="omikuji-slip-kind" lang="ja">
          おみくじ
        </p>
        <p className="omikuji-fortune" lang="ja">
          {pick.fortune.label}
        </p>
        <p className="omikuji-message">{message[lang]}</p>
        <div className="omikuji-word">
          <p className="omikuji-word-label">{t('omikuji.expression')}</p>
          <p className="omikuji-word-text" lang="ja">
            {item.text}
          </p>
          {item.reading === undefined ? null : (
            <p className="omikuji-word-reading" lang="ja">
              {item.reading}
            </p>
          )}
          <p className="omikuji-word-meaning">{item.meaning[lang]}</p>
          <p className="omikuji-word-example">
            <span lang="ja">{item.example}</span>
            {lang === 'ko' ? (
              <>
                <br />
                {item.exampleKo}
              </>
            ) : null}
          </p>
        </div>
      </div>
      <OmikujiYay />
    </div>
  )
}
