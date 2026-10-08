import {
  chmodSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createFilePracticeCompatibilityAuthority,
  loadPracticeCompatibilityAuthority,
  parsePracticeCompatibilityAuthority,
  PracticeCompatibilityAuthorityError
} from './practiceCompatibilityAuthority.js'

const validAuthority = {
  schemaVersion: 1,
  generationLeaseId: '550e8400-e29b-41d4-a716-446655440000',
  exclusiveGenerationLeaseHeld: true,
  v2CapableWritersDrained: true,
  v2WriteExposureEverEnabled: false
} as const

let temporaryDirectory: string | undefined

afterEach(() => {
  if (temporaryDirectory) {
    rmSync(temporaryDirectory, { force: true, recursive: true })
    temporaryDirectory = undefined
  }
})

describe('practice compatibility authority', () => {
  it('외부 monotonic record의 exact shape만 허용한다', () => {
    expect(parsePracticeCompatibilityAuthority(validAuthority)).toEqual(
      validAuthority
    )

    for (const invalid of [
      { ...validAuthority, exclusiveGenerationLeaseHeld: false },
      { ...validAuthority, v2CapableWritersDrained: false },
      { ...validAuthority, v2WriteExposureEverEnabled: true },
      { ...validAuthority, unexpected: true }
    ]) {
      expect(() => parsePracticeCompatibilityAuthority(invalid)).toThrow(
        PracticeCompatibilityAuthorityError
      )
    }
  })

  it('절대 경로의 일반 파일이며 group/other writable이 아닐 때만 읽는다', () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'nihongo-authority-'))
    const authorityFile = join(temporaryDirectory, 'authority.json')
    writeFileSync(authorityFile, JSON.stringify(validAuthority), {
      mode: 0o600
    })

    expect(loadPracticeCompatibilityAuthority(authorityFile)).toEqual(
      validAuthority
    )

    const handle = createFilePracticeCompatibilityAuthority(authorityFile)
    expect(handle.generationLeaseId).toBe(validAuthority.generationLeaseId)
    expect(() => handle.assertValid()).not.toThrow()

    writeFileSync(
      authorityFile,
      JSON.stringify({
        ...validAuthority,
        generationLeaseId: '550e8400-e29b-41d4-a716-446655440001'
      })
    )
    expect(() => handle.assertValid()).toThrow(
      PracticeCompatibilityAuthorityError
    )

    chmodSync(authorityFile, 0o622)
    expect(() => loadPracticeCompatibilityAuthority(authorityFile)).toThrow(
      PracticeCompatibilityAuthorityError
    )
    expect(() => loadPracticeCompatibilityAuthority('authority.json')).toThrow(
      PracticeCompatibilityAuthorityError
    )

    chmodSync(authorityFile, 0o600)
    const authorityLink = join(temporaryDirectory, 'authority-link.json')
    symlinkSync(authorityFile, authorityLink)
    expect(() => loadPracticeCompatibilityAuthority(authorityLink)).toThrow(
      PracticeCompatibilityAuthorityError
    )
  })
})
