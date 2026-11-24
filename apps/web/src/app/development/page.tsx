import { useState } from 'react'
import { useUiLocale } from '@nihongo/browser/provider/I18nProvider'
import { Badge } from '@nihongo/browser/common/components/Badge'
import { Button } from '@nihongo/browser/common/components/Button'
import { useConnectionStatus } from '@app/development/hooks/useConnectionStatus'
import { connectionMessages } from '@app/development/messages'

export const ConnectionPage = () => {
  const { locale } = useUiLocale()
  const text = connectionMessages[locale]
  const { status, retry } = useConnectionStatus()
  const [hasRetried, setHasRetried] = useState(false)
  const checking = status === 'checking'
  return (
    <main className="connection-page">
      <section className="connection-card" aria-labelledby="connection-heading">
        <h1 id="connection-heading" className="connection-title">
          {text.title}
        </h1>
        <p className="connection-description">{text.description}</p>
        <div
          role="status"
          aria-live="polite"
          aria-busy={checking}
          className="connection-status"
        >
          <div className="connection-state">
            <span aria-hidden="true">
              {checking ? '…' : status === 'connected' ? '✓' : '!'}
            </span>
            <Badge
              variant={
                checking
                  ? 'info'
                  : status === 'connected'
                    ? 'success'
                    : 'danger'
              }
            >
              {text[status]}
            </Badge>
          </div>
          <p>{text[`${status}Detail`]}</p>
        </div>
        {(status === 'failed' || hasRetried) && (
          <Button
            aria-disabled={checking}
            aria-busy={checking}
            className="connection-retry"
            onClick={() => {
              if (checking) return
              setHasRetried(true)
              retry()
            }}
          >
            {checking ? text.retrying : text.retry}
          </Button>
        )}
        <p className="connection-scope">{text.scope}</p>
      </section>
    </main>
  )
}
