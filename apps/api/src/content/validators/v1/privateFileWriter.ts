import { constants, type BigIntStats } from 'node:fs'
import { link, lstat, open, realpath, unlink } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import path from 'node:path'

export type PrivateFileWriteErrorCode =
  | 'OUTPUT_DIRECTORY_INVALID'
  | 'OUTPUT_EXISTS'
  | 'OUTPUT_PATH_INVALID'
  | 'OUTPUT_PUBLISH_FAILED'

export class PrivateFileWriteError extends Error {
  readonly code: PrivateFileWriteErrorCode

  constructor(code: PrivateFileWriteErrorCode, message: string) {
    super(message)
    this.name = 'PrivateFileWriteError'
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

const sameFileIdentity = (left: BigIntStats, right: BigIntStats): boolean =>
  left.dev === right.dev && left.ino === right.ino

const assertLexicalDirectoryChain = async (
  directory: string
): Promise<void> => {
  const normalized = path.normalize(directory)
  const parsed = path.parse(normalized)
  const segments = normalized
    .slice(parsed.root.length)
    .split(path.sep)
    .filter(Boolean)
  let current = parsed.root
  for (const segment of segments) {
    current = path.join(current, segment)
    const metadata = await lstat(current, { bigint: true })
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new PrivateFileWriteError(
        'OUTPUT_DIRECTORY_INVALID',
        'output path의 모든 parent는 실제 directory여야 합니다.'
      )
    }
  }
}

export interface WriteNewPrivateFileInput {
  readonly outputPath: string
  readonly bytes: Uint8Array
  readonly maximumBytes: number
  readonly forbiddenRoot?: string
}

export const writeNewPrivateFile = async ({
  outputPath,
  bytes,
  maximumBytes,
  forbiddenRoot
}: WriteNewPrivateFileInput): Promise<void> => {
  if (
    !path.isAbsolute(outputPath) ||
    !Number.isSafeInteger(maximumBytes) ||
    maximumBytes < 1 ||
    bytes.byteLength > maximumBytes
  ) {
    throw new PrivateFileWriteError(
      'OUTPUT_PATH_INVALID',
      'output path 또는 byte cap이 유효하지 않습니다.'
    )
  }

  const parent = path.dirname(outputPath)
  await assertLexicalDirectoryChain(parent)
  const canonicalParent = await realpath(parent)
  if (canonicalParent !== path.normalize(parent)) {
    throw new PrivateFileWriteError(
      'OUTPUT_DIRECTORY_INVALID',
      'output directory alias 또는 symlink를 허용하지 않습니다.'
    )
  }
  const parentStat = await lstat(canonicalParent, { bigint: true })
  if (
    !parentStat.isDirectory() ||
    parentStat.isSymbolicLink() ||
    (parentStat.mode & 0o777n) !== 0o700n
  ) {
    throw new PrivateFileWriteError(
      'OUTPUT_DIRECTORY_INVALID',
      'output directory는 symlink가 아닌 mode 0700 directory여야 합니다.'
    )
  }

  const canonicalOutput = path.join(canonicalParent, path.basename(outputPath))
  if (forbiddenRoot !== undefined) {
    const canonicalForbiddenRoot = await realpath(forbiddenRoot)
    if (isInside(canonicalForbiddenRoot, canonicalOutput)) {
      throw new PrivateFileWriteError(
        'OUTPUT_PATH_INVALID',
        'private output은 repository 내부에 쓸 수 없습니다.'
      )
    }
  }

  const temporaryPath = path.join(
    canonicalParent,
    `.${path.basename(outputPath)}.${randomBytes(12).toString('hex')}.tmp`
  )
  let temporaryCreated = false
  let temporaryIdentity: BigIntStats | undefined
  try {
    const handle = await open(
      temporaryPath,
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_WRONLY |
        constants.O_NOFOLLOW,
      0o600
    )
    temporaryCreated = true
    try {
      const opened = await handle.stat({ bigint: true })
      const lexicalTemp = await lstat(temporaryPath, { bigint: true })
      const currentParent = await lstat(canonicalParent, { bigint: true })
      if (
        !opened.isFile() ||
        !lexicalTemp.isFile() ||
        !sameFileIdentity(opened, lexicalTemp) ||
        !sameFileIdentity(parentStat, currentParent)
      ) {
        throw new PrivateFileWriteError(
          'OUTPUT_PUBLISH_FAILED',
          'private output temp 또는 parent identity가 달라졌습니다.'
        )
      }
      await handle.writeFile(bytes)
      await handle.chmod(0o600)
      await handle.sync()
      const written = await handle.stat({ bigint: true })
      const writtenPath = await lstat(temporaryPath, { bigint: true })
      if (
        !sameFileIdentity(written, writtenPath) ||
        written.size !== BigInt(bytes.byteLength) ||
        (written.mode & 0o777n) !== 0o600n
      ) {
        throw new PrivateFileWriteError(
          'OUTPUT_PUBLISH_FAILED',
          'private output temp bytes 또는 mode가 유효하지 않습니다.'
        )
      }
      temporaryIdentity = written
    } finally {
      await handle.close()
    }

    const parentBeforePublish = await lstat(canonicalParent, { bigint: true })
    if (!sameFileIdentity(parentStat, parentBeforePublish)) {
      throw new PrivateFileWriteError(
        'OUTPUT_PUBLISH_FAILED',
        'output parent identity가 publication 전에 달라졌습니다.'
      )
    }
    try {
      await link(temporaryPath, canonicalOutput)
    } catch (error: unknown) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'EEXIST'
      ) {
        throw new PrivateFileWriteError(
          'OUTPUT_EXISTS',
          'existing output을 덮어쓰지 않습니다.'
        )
      }
      throw new PrivateFileWriteError(
        'OUTPUT_PUBLISH_FAILED',
        'private output publication에 실패했습니다.'
      )
    }
    await unlink(temporaryPath)
    temporaryCreated = false

    const published = await lstat(canonicalOutput, { bigint: true })
    if (
      temporaryIdentity === undefined ||
      !published.isFile() ||
      published.isSymbolicLink() ||
      !sameFileIdentity(temporaryIdentity, published) ||
      published.size !== BigInt(bytes.byteLength) ||
      (published.mode & 0o777n) !== 0o600n
    ) {
      throw new PrivateFileWriteError(
        'OUTPUT_PUBLISH_FAILED',
        'published private output metadata가 유효하지 않습니다.'
      )
    }

    const directoryHandle = await open(canonicalParent, constants.O_RDONLY)
    try {
      await directoryHandle.sync()
    } finally {
      await directoryHandle.close()
    }
  } finally {
    if (temporaryCreated) {
      await unlink(temporaryPath).catch(() => undefined)
    }
  }
}
