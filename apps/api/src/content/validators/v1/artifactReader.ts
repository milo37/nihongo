import { constants, type BigIntStats } from 'node:fs'
import { lstat, open, realpath, type FileHandle } from 'node:fs/promises'
import path from 'node:path'
import { parseStrictJsonBytes } from './strictJson.js'

export type ArtifactReadErrorCode =
  | 'ARTIFACT_CHANGED'
  | 'ARTIFACT_NOT_REGULAR'
  | 'ARTIFACT_OUTSIDE_ROOT'
  | 'ARTIFACT_OVERSIZED'
  | 'ARTIFACT_PATH_INVALID'
  | 'ARTIFACT_SYMLINK'
  | 'ARTIFACT_UNSAFE_MODE'

export class ArtifactReadError extends Error {
  readonly code: ArtifactReadErrorCode

  constructor(code: ArtifactReadErrorCode, message: string) {
    super(message)
    this.name = 'ArtifactReadError'
    this.code = code
  }
}

const isInside = (parent: string, candidate: string): boolean => {
  const relative = path.relative(parent, candidate)
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== '..' &&
      !path.isAbsolute(relative))
  )
}

const sameIdentity = (left: BigIntStats, right: BigIntStats): boolean =>
  left.dev === right.dev &&
  left.ino === right.ino &&
  left.size === right.size &&
  left.mtimeNs === right.mtimeNs &&
  left.ctimeNs === right.ctimeNs

interface PathIdentity {
  readonly filePath: string
  readonly metadata: BigIntStats
}

const readExact = async (handle: FileHandle, size: number): Promise<Buffer> => {
  const buffer = Buffer.allocUnsafe(size)
  let offset = 0
  while (offset < size) {
    const { bytesRead } = await handle.read(
      buffer,
      offset,
      size - offset,
      offset
    )
    if (bytesRead === 0) {
      throw new ArtifactReadError(
        'ARTIFACT_CHANGED',
        'artifact가 read 도중 짧아졌습니다.'
      )
    }
    offset += bytesRead
  }
  const extra = Buffer.alloc(1)
  const { bytesRead: extraBytes } = await handle.read(extra, 0, 1, size)
  if (extraBytes !== 0) {
    throw new ArtifactReadError(
      'ARTIFACT_CHANGED',
      'artifact가 read 도중 길어졌습니다.'
    )
  }
  return buffer
}

const assertNoSymlinkBelowRoot = async (
  canonicalRoot: string,
  candidate: string
): Promise<readonly PathIdentity[]> => {
  const relative = path.relative(canonicalRoot, candidate)
  if (!isInside(canonicalRoot, candidate)) {
    throw new ArtifactReadError(
      'ARTIFACT_OUTSIDE_ROOT',
      'artifact는 허용 root 내부여야 합니다.'
    )
  }
  const segments = relative.split(path.sep).filter(Boolean)
  let current = canonicalRoot
  const identities: PathIdentity[] = []
  for (const segment of segments) {
    current = path.join(current, segment)
    const stat = await lstat(current, { bigint: true })
    if (stat.isSymbolicLink()) {
      throw new ArtifactReadError(
        'ARTIFACT_SYMLINK',
        'artifact path의 symlink를 허용하지 않습니다.'
      )
    }
    identities.push({ filePath: current, metadata: stat })
  }
  return identities
}

const assertPathIdentitiesUnchanged = async (
  identities: readonly PathIdentity[]
): Promise<void> => {
  for (const identity of identities) {
    const current = await lstat(identity.filePath, { bigint: true })
    if (current.isSymbolicLink() || !sameIdentity(identity.metadata, current)) {
      throw new ArtifactReadError(
        'ARTIFACT_CHANGED',
        'artifact path identity가 검사 도중 달라졌습니다.'
      )
    }
  }
}

export interface ReadArtifactInput {
  readonly repositoryRoot: string
  readonly filePath: string
  readonly maximumBytes: number
}

const readArtifactBytesInternal = async ({
  repositoryRoot,
  filePath,
  maximumBytes
}: ReadArtifactInput): Promise<Buffer> => {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new ArtifactReadError(
      'ARTIFACT_PATH_INVALID',
      'maximumBytes가 유효하지 않습니다.'
    )
  }
  const canonicalRoot = await realpath(repositoryRoot)
  const lexicalCandidate = path.isAbsolute(filePath)
    ? path.normalize(filePath)
    : path.resolve(canonicalRoot, filePath)
  const pathIdentities = await assertNoSymlinkBelowRoot(
    canonicalRoot,
    lexicalCandidate
  )
  const canonicalCandidate = await realpath(lexicalCandidate)
  if (!isInside(canonicalRoot, canonicalCandidate)) {
    throw new ArtifactReadError(
      'ARTIFACT_OUTSIDE_ROOT',
      'artifact realpath가 허용 root 밖입니다.'
    )
  }

  const before = await lstat(canonicalCandidate, { bigint: true })
  if (!before.isFile()) {
    throw new ArtifactReadError(
      'ARTIFACT_NOT_REGULAR',
      'regular artifact file만 허용합니다.'
    )
  }
  if ((before.mode & 0o22n) !== 0n) {
    throw new ArtifactReadError(
      'ARTIFACT_UNSAFE_MODE',
      'group/world writable artifact를 거부합니다.'
    )
  }
  if (before.size < 0n || before.size > BigInt(maximumBytes)) {
    throw new ArtifactReadError(
      'ARTIFACT_OVERSIZED',
      'artifact byte cap을 초과했습니다.'
    )
  }

  const handle = await open(
    canonicalCandidate,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
  )
  try {
    const opened = await handle.stat({ bigint: true })
    if (!opened.isFile() || !sameIdentity(before, opened)) {
      throw new ArtifactReadError(
        'ARTIFACT_CHANGED',
        'artifact identity가 open 전후 달라졌습니다.'
      )
    }
    await assertPathIdentitiesUnchanged(pathIdentities)
    const bytes = await readExact(handle, Number(opened.size))
    const after = await handle.stat({ bigint: true })
    if (!sameIdentity(opened, after)) {
      throw new ArtifactReadError(
        'ARTIFACT_CHANGED',
        'artifact identity가 read 도중 달라졌습니다.'
      )
    }
    await assertPathIdentitiesUnchanged(pathIdentities)
    return bytes
  } finally {
    await handle.close()
  }
}

export const readArtifactBytes = async (
  input: ReadArtifactInput
): Promise<Buffer> => {
  try {
    return await readArtifactBytesInternal(input)
  } catch (error: unknown) {
    if (error instanceof ArtifactReadError) throw error
    throw new ArtifactReadError(
      'ARTIFACT_CHANGED',
      'artifact를 안전하게 열고 읽을 수 없습니다.'
    )
  }
}

export const readArtifactJson = async (
  input: ReadArtifactInput
): Promise<unknown> => parseStrictJsonBytes(await readArtifactBytes(input))

export interface ReadPrivateArtifactInput {
  readonly repositoryRoot: string
  readonly filePath: string
  readonly maximumBytes: number
}

export const readPrivateArtifactBytes = async ({
  repositoryRoot,
  filePath,
  maximumBytes
}: ReadPrivateArtifactInput): Promise<Buffer> => {
  if (!path.isAbsolute(filePath)) {
    throw new ArtifactReadError(
      'ARTIFACT_PATH_INVALID',
      'private artifact path는 absolute여야 합니다.'
    )
  }
  const lexicalParent = path.dirname(path.normalize(filePath))
  const canonicalParent = await realpath(lexicalParent)
  if (canonicalParent !== lexicalParent) {
    throw new ArtifactReadError(
      'ARTIFACT_SYMLINK',
      'private artifact parent alias/symlink를 허용하지 않습니다.'
    )
  }
  const canonicalRepositoryRoot = await realpath(repositoryRoot)
  if (isInside(canonicalRepositoryRoot, filePath)) {
    throw new ArtifactReadError(
      'ARTIFACT_PATH_INVALID',
      'review evidence는 repository 밖에 있어야 합니다.'
    )
  }
  const parentMetadata = await lstat(canonicalParent, { bigint: true })
  const fileMetadata = await lstat(filePath, { bigint: true })
  if (
    !parentMetadata.isDirectory() ||
    parentMetadata.isSymbolicLink() ||
    (parentMetadata.mode & 0o777n) !== 0o700n ||
    !fileMetadata.isFile() ||
    fileMetadata.isSymbolicLink() ||
    (fileMetadata.mode & 0o777n) !== 0o600n
  ) {
    throw new ArtifactReadError(
      'ARTIFACT_UNSAFE_MODE',
      'private artifact는 real 0700 parent와 exact 0600 file이 필요합니다.'
    )
  }
  const value = await readArtifactBytes({
    repositoryRoot: canonicalParent,
    filePath: path.basename(filePath),
    maximumBytes
  })
  const [parentAfter, fileAfter] = await Promise.all([
    lstat(canonicalParent, { bigint: true }),
    lstat(filePath, { bigint: true })
  ])
  if (
    !sameIdentity(parentMetadata, parentAfter) ||
    !sameIdentity(fileMetadata, fileAfter)
  ) {
    throw new ArtifactReadError(
      'ARTIFACT_CHANGED',
      'private artifact identity가 검사 도중 달라졌습니다.'
    )
  }
  return Buffer.from(value)
}

export const readPrivateArtifactJson = async (
  input: ReadPrivateArtifactInput
): Promise<unknown> =>
  parseStrictJsonBytes(await readPrivateArtifactBytes(input))
