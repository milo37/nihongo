import { isAbsolute } from 'node:path'
import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readFileSync
} from 'node:fs'
import { z } from 'zod'

const MAX_AUTHORITY_FILE_BYTES = 4_096

const practiceCompatibilityAuthoritySchema = z
  .object({
    schemaVersion: z.literal(1),
    generationLeaseId: z.uuid(),
    exclusiveGenerationLeaseHeld: z.literal(true),
    v2CapableWritersDrained: z.literal(true),
    v2WriteExposureEverEnabled: z.literal(false)
  })
  .strict()

export type PracticeCompatibilityAuthority = z.output<
  typeof practiceCompatibilityAuthoritySchema
>

export interface PracticeCompatibilityAuthorityHandle {
  generationLeaseId: string
  assertValid: () => void
}

export class PracticeCompatibilityAuthorityError extends Error {
  constructor() {
    super('Practice compatibility authority validation failed.')
    this.name = 'PracticeCompatibilityAuthorityError'
  }
}

export const parsePracticeCompatibilityAuthority = (
  value: unknown
): PracticeCompatibilityAuthority => {
  const parsed = practiceCompatibilityAuthoritySchema.safeParse(value)
  if (!parsed.success) {
    throw new PracticeCompatibilityAuthorityError()
  }
  return parsed.data
}

export const loadPracticeCompatibilityAuthority = (
  authorityFile: string
): PracticeCompatibilityAuthority => {
  let descriptor: number | undefined
  try {
    if (!isAbsolute(authorityFile)) {
      throw new Error('Authority path must be absolute.')
    }
    descriptor = openSync(
      authorityFile,
      constants.O_RDONLY | constants.O_NOFOLLOW
    )
    const metadata = fstatSync(descriptor)
    if (
      !metadata.isFile() ||
      metadata.size < 1 ||
      metadata.size > MAX_AUTHORITY_FILE_BYTES ||
      (metadata.mode & 0o022) !== 0
    ) {
      throw new Error('Authority file metadata is unsafe.')
    }
    const serialized = readFileSync(descriptor, 'utf8')
    if (Buffer.byteLength(serialized, 'utf8') > MAX_AUTHORITY_FILE_BYTES) {
      throw new Error('Authority file grew past its bounded size.')
    }
    return parsePracticeCompatibilityAuthority(JSON.parse(serialized))
  } catch {
    throw new PracticeCompatibilityAuthorityError()
  } finally {
    if (descriptor !== undefined) {
      closeSync(descriptor)
    }
  }
}

export const createFilePracticeCompatibilityAuthority = (
  authorityFile: string
): PracticeCompatibilityAuthorityHandle => {
  const initial = loadPracticeCompatibilityAuthority(authorityFile)

  return {
    generationLeaseId: initial.generationLeaseId,
    assertValid: () => {
      const current = loadPracticeCompatibilityAuthority(authorityFile)
      if (current.generationLeaseId !== initial.generationLeaseId) {
        throw new PracticeCompatibilityAuthorityError()
      }
    }
  }
}
