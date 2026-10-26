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
    <main className="min-h-screen bg-canvas px-page-gutter py-8 text-ink">
      <section
        className="mx-auto flex w-full max-w-[40rem] flex-col gap-4 rounded-card border border-line bg-surface p-5"
        aria-labelledby="connection-heading"
      >
        <h1 id="connection-heading" className="text-xl font-bold">
          {text.title}
        </h1>
        <p className="text-muted">{text.description}</p>
        <div
          role="status"
          aria-live="polite"
          aria-busy={checking}
          className="flex flex-col gap-3"
        >
          <div className="flex items-center gap-2">
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
            className="w-full sm:w-fit"
            onClick={() => {
              if (checking) return
              setHasRetried(true)
              retry()
            }}
          >
            {checking ? text.retrying : text.retry}
          </Button>
        )}
        <p className="text-sm text-muted">{text.scope}</p>
      </section>
    </main>
  )
}
