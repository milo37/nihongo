import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import type {
  AdminImportValidationResponse,
  ValidateQuestionImportRequest
} from '@nihongo/contracts/admin/content-operations'
import { assertCurrentAuthActorTransitionFence } from '@nihongo/browser/libs/authTransitionFence'
import { useAppStore } from '@nihongo/browser/store/index'
import { useAdminPresentation } from '@app/admin/presentation/useAdminPresentation'
import {
  useValidateImport,
  useApplyImport,
  useRecoverImportResult,
  useImportOnline
} from '@app/admin-import/hooks/useAdminImport'
import { ImportFileError, readImportFile } from '@app/admin-import/importFile'

const errorCode = (error: unknown): string | null =>
  error &&
  typeof error === 'object' &&
  'code' in error &&
  typeof error.code === 'string'
    ? error.code
    : null

const flag = (error: unknown, name: string): boolean =>
  Boolean(
    error &&
      typeof error === 'object' &&
      name in error &&
      (error as Record<string, unknown>)[name] === true
  )

const status = (error: unknown): number | null =>
  error &&
  typeof error === 'object' &&
  'status' in error &&
  typeof error.status === 'number'
    ? error.status
    : null

// The request may have committed: the server or a gateway failed (including
// an unparseable 5xx body), or no response arrived.
const isUnknownApplyOutcome = (error: unknown): boolean =>
  flag(error, 'isServerError') ||
  (status(error) ?? 0) >= 500 ||
  (flag(error, 'isNetworkError') && !flag(error, 'isOffline'))

type RecoveryState = 'checking' | 'notApplied' | 'failed'

/** Import file selection, validation, apply and unknown-outcome recovery. */
export const useQuestionImport = ({
  actorId,
  epoch
}: {
  actorId: string
  epoch: number
}) => {
  const { t, presentError } = useAdminPresentation()
  const online = useImportOnline()
  const validation = useValidateImport()
  const applyImport = useApplyImport()
  const recoverResult = useRecoverImportResult()
  const [recovery, setRecovery] = useState<RecoveryState | null>(null)
  const [request, setRequest] = useState<ValidateQuestionImportRequest | null>(
    null
  )
  const [validated, setValidated] = useState<{
    request: ValidateQuestionImportRequest
    result: AdminImportValidationResponse
    revision: number
  } | null>(null)
  const [fileName, setFileName] = useState('')
  const [fileError, setFileError] = useState<'FORMAT' | 'SIZE' | null>(null)
  const [reading, setReading] = useState(false)
  const [createdCount, setCreatedCount] = useState<number | null>(null)
  const [appliedDigests, setAppliedDigests] = useState<ReadonlySet<string>>(
    () => new Set()
  )
  const selectionRevision = useRef(0)
  const operationInFlight = useRef(false)
  // One importId per validated payload, so a retried apply replays instead of duplicating.
  const importIds = useRef(new Map<string, string>())
  const fileInput = useRef<HTMLInputElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const resultHeading = useRef<HTMLHeadingElement>(null)
  useEffect(
    () => () => {
      selectionRevision.current += 1
    },
    []
  )
  const pending = validation.isPending || applyImport.isPending
  const assertActor = (): void =>
    assertCurrentAuthActorTransitionFence(
      { actorId, epoch, role: 'ADMIN' },
      useAppStore.getState().currentUser
    )
  const selectFile = async (
    event: ChangeEvent<HTMLInputElement>
  ): Promise<void> => {
    const revision = selectionRevision.current + 1
    selectionRevision.current = revision
    const file = event.currentTarget.files?.[0]
    validation.reset()
    applyImport.reset()
    setRecovery(null)
    setRequest(null)
    setValidated(null)
    setCreatedCount(null)
    setFileError(null)
    setFileName(file?.name ?? '')
    setReading(Boolean(file))
    if (!file) return
    try {
      assertActor()
      const parsed = await readImportFile(file)
      assertActor()
      if (selectionRevision.current !== revision) return
      setRequest(parsed)
    } catch (error) {
      if (selectionRevision.current !== revision) return
      try {
        assertActor()
      } catch {
        return
      }
      setFileError(error instanceof ImportFileError ? error.kind : 'FORMAT')
      fileInput.current?.focus()
    } finally {
      if (selectionRevision.current === revision) setReading(false)
    }
  }
  const validate = async (): Promise<void> => {
    if (!request || reading || !online || pending || operationInFlight.current)
      return
    operationInFlight.current = true
    const revision = selectionRevision.current
    const input = request
    setValidated(null)
    setCreatedCount(null)
    applyImport.reset()
    setRecovery(null)
    try {
      const result = await validation.mutateAsync(input)
      if (selectionRevision.current !== revision) return
      assertActor()
      setValidated({ request: input, result, revision })
      requestAnimationFrame(() => {
        if (selectionRevision.current === revision)
          resultHeading.current?.focus()
      })
    } catch {
      /* The current mutation exposes the canonical error. */
    } finally {
      operationInFlight.current = false
    }
  }
  const apply = async (): Promise<void> => {
    if (
      !request ||
      !validated ||
      validated.request !== request ||
      validated.revision !== selectionRevision.current ||
      !validated.result.valid ||
      appliedDigests.has(validated.result.validationDigest) ||
      reading ||
      !online ||
      pending ||
      operationInFlight.current
    )
      return
    operationInFlight.current = true
    const revision = selectionRevision.current
    const digest = validated.result.validationDigest
    const importId = importIds.current.get(digest) ?? crypto.randomUUID()
    importIds.current.set(digest, importId)
    setRecovery(null)
    try {
      const result = await applyImport.mutateAsync({
        importId,
        items: validated.request.items,
        validationDigest: digest
      })
      if (selectionRevision.current !== revision) return
      assertActor()
      setCreatedCount(result.createdCount)
      setAppliedDigests((previous) => new Set([...previous, digest]))
      requestAnimationFrame(() => {
        if (selectionRevision.current === revision) heading.current?.focus()
      })
    } catch (error) {
      if (selectionRevision.current !== revision) return
      if (
        ['IMPORT_VALIDATION_FAILED', 'IMPORT_IDENTITY_CONFLICT'].includes(
          errorCode(error) ?? ''
        )
      )
        setValidated(null)
      else if (isUnknownApplyOutcome(error)) {
        setRecovery('checking')
        try {
          const recovered = await recoverResult(importId)
          if (selectionRevision.current !== revision) return
          assertActor()
          applyImport.reset()
          setRecovery(null)
          setCreatedCount(recovered.createdCount)
          setAppliedDigests((previous) => new Set([...previous, digest]))
          requestAnimationFrame(() => {
            if (selectionRevision.current === revision) heading.current?.focus()
          })
        } catch (recoveryError) {
          if (selectionRevision.current !== revision) return
          setRecovery(
            flag(recoveryError, 'isNotFoundError') ? 'notApplied' : 'failed'
          )
        }
      }
    } finally {
      operationInFlight.current = false
    }
  }
  const operationError = applyImport.error ?? validation.error
  const needsFresh = errorCode(applyImport.error) === 'FRESH_ASSURANCE_REQUIRED'
  const canApply = Boolean(
    validated &&
      validated.request === request &&
      validated.result.valid &&
      !appliedDigests.has(validated.result.validationDigest) &&
      !pending &&
      !reading &&
      online
  )
  return {
    t,
    presentError,
    online,
    validation,
    applyImport,
    recovery,
    request,
    validated,
    fileName,
    fileError,
    reading,
    createdCount,
    fileInput,
    heading,
    resultHeading,
    pending,
    assertActor,
    selectFile,
    validate,
    apply,
    operationError,
    needsFresh,
    canApply
  }
}
