import { randomBytes } from 'node:crypto'
import { constants, type BigIntStats } from 'node:fs'
import {
  link,
  lstat,
  mkdir,
  open,
  realpath,
  rename,
  unlink,
  type FileHandle
} from 'node:fs/promises'
import path from 'node:path'
import { readArtifactBytes } from './artifactReader.js'

const sameFileIdentity = (left: BigIntStats, right: BigIntStats): boolean =>
  left.dev === right.dev && left.ino === right.ino

const sameFileVersion = (left: BigIntStats, right: BigIntStats): boolean =>
  sameFileIdentity(left, right) &&
  left.size === right.size &&
  left.mode === right.mode &&
  left.mtimeNs === right.mtimeNs &&
  left.ctimeNs === right.ctimeNs

const readExactHandleBytes = async (
  handle: FileHandle,
  byteLength: number
): Promise<Buffer> => {
  const bytes = Buffer.alloc(byteLength)
  let offset = 0
  while (offset < byteLength) {
    const { bytesRead } = await handle.read(
      bytes,
      offset,
      byteLength - offset,
      offset
    )
    if (bytesRead === 0) {
      throw new Error('TRACKED_ARTIFACT_PUBLISH_FAILED')
    }
    offset += bytesRead
  }
  const trailing = Buffer.alloc(1)
  if ((await handle.read(trailing, 0, 1, byteLength)).bytesRead !== 0) {
    throw new Error('TRACKED_ARTIFACT_PUBLISH_FAILED')
  }
  return bytes
}

const writeExactHandleBytes = async (
  handle: FileHandle,
  bytes: Uint8Array
): Promise<void> => {
  const source = Buffer.from(bytes)
  await handle.truncate(0)
  let offset = 0
  while (offset < source.byteLength) {
    const { bytesWritten } = await handle.write(
      source,
      offset,
      source.byteLength - offset,
      offset
    )
    if (bytesWritten === 0) {
      throw new Error('TRACKED_ARTIFACT_PUBLISH_FAILED')
    }
    offset += bytesWritten
  }
  await handle.truncate(source.byteLength)
  await handle.chmod(0o644)
  await handle.sync()
}

const syncDirectory = async (directory: string): Promise<void> => {
  const handle = await open(directory, constants.O_RDONLY)
  try {
    await handle.sync()
  } finally {
    await handle.close()
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

const isMissing = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  error.code === 'ENOENT'

const isAlreadyExisting = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  error.code === 'EEXIST'

const ensureParentDirectories = async (
  repositoryRoot: string,
  parent: string
): Promise<void> => {
  const relative = path.relative(repositoryRoot, parent)
  let current = repositoryRoot
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment)
    try {
      const metadata = await lstat(current, { bigint: true })
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
        throw new Error('TRACKED_ARTIFACT_PARENT_INVALID')
      }
    } catch (error: unknown) {
      if (!isMissing(error)) throw error
      await mkdir(current, { mode: 0o755 })
      const created = await lstat(current, { bigint: true })
      if (!created.isDirectory() || created.isSymbolicLink()) {
        throw new Error('TRACKED_ARTIFACT_PARENT_INVALID')
      }
    }
  }
}

const createPublicationStagingDirectory = async (
  repositoryRoot: string
): Promise<{ readonly directory: string; readonly metadata: BigIntStats }> => {
  const stagingRoot = path.join(
    repositoryRoot,
    'content',
    '.tracked-artifact-staging'
  )
  await ensureParentDirectories(repositoryRoot, path.dirname(stagingRoot))
  try {
    await mkdir(stagingRoot, { mode: 0o700 })
  } catch (error: unknown) {
    if (!isAlreadyExisting(error)) throw error
  }
  const stagingRootMetadata = await lstat(stagingRoot, { bigint: true })
  if (
    !stagingRootMetadata.isDirectory() ||
    stagingRootMetadata.isSymbolicLink() ||
    (stagingRootMetadata.mode & 0o777n) !== 0o700n ||
    (await realpath(stagingRoot)) !== stagingRoot
  ) {
    throw new Error('TRACKED_ARTIFACT_PARENT_INVALID')
  }
  const directory = path.join(stagingRoot, randomBytes(12).toString('hex'))
  await mkdir(directory, { mode: 0o700 })
  const metadata = await lstat(directory, { bigint: true })
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    (metadata.mode & 0o777n) !== 0o700n ||
    (await realpath(directory)) !== directory ||
    !sameFileIdentity(
      stagingRootMetadata,
      await lstat(stagingRoot, { bigint: true })
    )
  ) {
    throw new Error('TRACKED_ARTIFACT_PARENT_INVALID')
  }
  await syncDirectory(stagingRoot)
  return { directory, metadata }
}

export interface WriteTrackedArtifactInput {
  readonly repositoryRoot: string
  readonly repositoryPath: string
  readonly bytes: Uint8Array
  readonly maximumBytes: number
  readonly expectedExistingBytes?: Uint8Array | null
}

export interface WriteTrackedArtifactTestDependenciesV1 {
  readonly afterReplacementPublished?: (paths: {
    readonly outputPath: string
    readonly rollbackPath: string
  }) => Promise<void>
}

export const writeTrackedArtifactWithTestDependencies = async (
  {
    repositoryRoot,
    repositoryPath,
    bytes,
    maximumBytes,
    expectedExistingBytes
  }: WriteTrackedArtifactInput,
  { afterReplacementPublished }: WriteTrackedArtifactTestDependenciesV1
): Promise<void> => {
  if (
    !/^content\/[A-Za-z0-9._/-]+$/.test(repositoryPath) ||
    repositoryPath.split('/').some((part) => part === '.' || part === '..') ||
    bytes.byteLength > maximumBytes
  ) {
    throw new Error('TRACKED_ARTIFACT_PATH_INVALID')
  }
  const canonicalRepositoryRoot = await realpath(repositoryRoot)
  const outputPath = path.resolve(canonicalRepositoryRoot, repositoryPath)
  if (!isInside(path.join(canonicalRepositoryRoot, 'content'), outputPath)) {
    throw new Error('TRACKED_ARTIFACT_PATH_INVALID')
  }
  const parent = path.dirname(outputPath)
  await ensureParentDirectories(canonicalRepositoryRoot, parent)
  const canonicalParent = await realpath(parent)
  if (canonicalParent !== parent) {
    throw new Error('TRACKED_ARTIFACT_PARENT_INVALID')
  }
  const parentMetadata = await lstat(parent, { bigint: true })
  if (
    !parentMetadata.isDirectory() ||
    parentMetadata.isSymbolicLink() ||
    (parentMetadata.mode & 0o022n) !== 0n
  ) {
    throw new Error('TRACKED_ARTIFACT_PARENT_INVALID')
  }

  let existingIdentity: BigIntStats | undefined
  try {
    const existing = await lstat(outputPath, { bigint: true })
    if (
      !existing.isFile() ||
      existing.isSymbolicLink() ||
      (existing.mode & 0o777n) !== 0o644n
    ) {
      throw new Error('TRACKED_ARTIFACT_EXISTS')
    }
    const existingBytes = await readArtifactBytes({
      repositoryRoot: canonicalRepositoryRoot,
      filePath: repositoryPath,
      maximumBytes
    })
    if (expectedExistingBytes !== undefined) {
      if (
        expectedExistingBytes === null ||
        !Buffer.from(existingBytes).equals(expectedExistingBytes)
      ) {
        throw new Error('TRACKED_ARTIFACT_EXISTS')
      }
      existingIdentity = existing
    } else if (!Buffer.from(existingBytes).equals(bytes)) {
      throw new Error('TRACKED_ARTIFACT_EXISTS')
    } else {
      return
    }
  } catch (error: unknown) {
    if (!isMissing(error)) {
      throw error
    }
    if (expectedExistingBytes !== undefined && expectedExistingBytes !== null) {
      throw new Error('TRACKED_ARTIFACT_EXISTS')
    }
  }

  const publicationStaging = await createPublicationStagingDirectory(
    canonicalRepositoryRoot
  )
  const temporaryPath = path.join(publicationStaging.directory, 'artifact.tmp')
  let temporaryCreated = false
  let temporaryIdentity: BigIntStats | undefined
  let publishedNewOutput = false
  let publishedNewIdentity: BigIntStats | undefined
  let rollbackPath: string | undefined
  let rollbackHandle: FileHandle | undefined
  let rollbackIdentity: BigIntStats | undefined
  let rollbackCreated = false
  let replacementPublished = false
  let replacementIdentity: BigIntStats | undefined
  try {
    const handle = await open(
      temporaryPath,
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_RDWR |
        constants.O_NOFOLLOW,
      0o600
    )
    temporaryCreated = true
    try {
      const opened = await handle.stat({ bigint: true })
      temporaryIdentity = opened
      const openedPath = await lstat(temporaryPath, { bigint: true })
      if (
        !opened.isFile() ||
        !sameFileIdentity(opened, openedPath) ||
        !sameFileIdentity(
          parentMetadata,
          await lstat(parent, { bigint: true })
        ) ||
        !sameFileIdentity(
          publicationStaging.metadata,
          await lstat(publicationStaging.directory, { bigint: true })
        )
      ) {
        throw new Error('TRACKED_ARTIFACT_PUBLISH_FAILED')
      }
      await handle.writeFile(bytes)
      await handle.chmod(0o644)
      await handle.sync()
      const writtenMetadata = await handle.stat({ bigint: true })
      if (
        writtenMetadata.size !== BigInt(bytes.byteLength) ||
        (writtenMetadata.mode & 0o777n) !== 0o644n ||
        !Buffer.from(
          await readExactHandleBytes(handle, bytes.byteLength)
        ).equals(bytes) ||
        !sameFileVersion(writtenMetadata, await handle.stat({ bigint: true }))
      ) {
        throw new Error('TRACKED_ARTIFACT_PUBLISH_FAILED')
      }
      if (
        !sameFileIdentity(
          parentMetadata,
          await lstat(parent, { bigint: true })
        ) ||
        !sameFileIdentity(
          publicationStaging.metadata,
          await lstat(publicationStaging.directory, { bigint: true })
        )
      ) {
        throw new Error('TRACKED_ARTIFACT_PUBLISH_FAILED')
      }
      if (
        expectedExistingBytes === undefined ||
        expectedExistingBytes === null
      ) {
        await link(temporaryPath, outputPath)
        publishedNewOutput = true
        publishedNewIdentity = await handle.stat({ bigint: true })
      } else {
        if (existingIdentity === undefined) {
          throw new Error('TRACKED_ARTIFACT_PUBLISH_FAILED')
        }
        const current = await lstat(outputPath, { bigint: true })
        const currentBytes = await readArtifactBytes({
          repositoryRoot: canonicalRepositoryRoot,
          filePath: repositoryPath,
          maximumBytes
        })
        if (
          !sameFileIdentity(existingIdentity, current) ||
          !Buffer.from(currentBytes).equals(expectedExistingBytes)
        ) {
          throw new Error('TRACKED_ARTIFACT_PUBLISH_FAILED')
        }
        rollbackPath = path.join(publicationStaging.directory, 'rollback.tmp')
        await link(outputPath, rollbackPath)
        rollbackCreated = true
        rollbackHandle = await open(
          rollbackPath,
          constants.O_RDWR | constants.O_NOFOLLOW
        )
        rollbackIdentity = await rollbackHandle.stat({ bigint: true })
        const rollbackPathIdentity = await lstat(rollbackPath, {
          bigint: true
        })
        const currentAfterRollbackLink = await lstat(outputPath, {
          bigint: true
        })
        if (
          !rollbackIdentity.isFile() ||
          !sameFileIdentity(existingIdentity, rollbackIdentity) ||
          !sameFileIdentity(rollbackIdentity, rollbackPathIdentity) ||
          !sameFileIdentity(rollbackIdentity, currentAfterRollbackLink) ||
          !Buffer.from(
            await readExactHandleBytes(
              rollbackHandle,
              expectedExistingBytes.byteLength
            )
          ).equals(expectedExistingBytes)
        ) {
          throw new Error('TRACKED_ARTIFACT_PUBLISH_FAILED')
        }
        await rename(temporaryPath, outputPath)
        temporaryCreated = false
        replacementPublished = true
        replacementIdentity = writtenMetadata
        await afterReplacementPublished?.({ outputPath, rollbackPath })
      }
      const beforePublishedRead = await handle.stat({ bigint: true })
      const published = await lstat(outputPath, { bigint: true })
      if (
        !sameFileVersion(beforePublishedRead, published) ||
        !Buffer.from(
          await readExactHandleBytes(handle, bytes.byteLength)
        ).equals(bytes)
      ) {
        throw new Error('TRACKED_ARTIFACT_PUBLISH_FAILED')
      }
      const publishedBytes = await readArtifactBytes({
        repositoryRoot: canonicalRepositoryRoot,
        filePath: repositoryPath,
        maximumBytes
      })
      const afterPublishedRead = await handle.stat({ bigint: true })
      const finalPublished = await lstat(outputPath, { bigint: true })
      if (
        !Buffer.from(publishedBytes).equals(bytes) ||
        !sameFileVersion(beforePublishedRead, afterPublishedRead) ||
        !sameFileVersion(afterPublishedRead, finalPublished)
      ) {
        throw new Error('TRACKED_ARTIFACT_PUBLISH_FAILED')
      }
      await syncDirectory(parent)
      if (publishedNewOutput) {
        const [stagingCurrent, temporaryCurrent] = await Promise.all([
          lstat(publicationStaging.directory, { bigint: true }),
          lstat(temporaryPath, { bigint: true })
        ])
        if (
          temporaryIdentity === undefined ||
          !sameFileIdentity(publicationStaging.metadata, stagingCurrent) ||
          !sameFileIdentity(temporaryIdentity, temporaryCurrent) ||
          (await realpath(publicationStaging.directory)) !==
            publicationStaging.directory
        ) {
          throw new Error('TRACKED_ARTIFACT_PUBLISH_FAILED')
        }
        await unlink(temporaryPath)
        temporaryCreated = false
        await syncDirectory(publicationStaging.directory)
        const finalAfterTemporaryRemoval = await lstat(outputPath, {
          bigint: true
        })
        const finalBytesAfterTemporaryRemoval = await readArtifactBytes({
          repositoryRoot: canonicalRepositoryRoot,
          filePath: repositoryPath,
          maximumBytes
        })
        if (
          publishedNewIdentity === undefined ||
          !sameFileIdentity(publishedNewIdentity, finalAfterTemporaryRemoval) ||
          !Buffer.from(finalBytesAfterTemporaryRemoval).equals(bytes)
        ) {
          throw new Error('TRACKED_ARTIFACT_PUBLISH_FAILED')
        }
        await syncDirectory(parent)
        publishedNewOutput = false
      }
      if (replacementPublished) {
        if (
          rollbackPath === undefined ||
          rollbackHandle === undefined ||
          !rollbackCreated ||
          expectedExistingBytes === undefined ||
          expectedExistingBytes === null
        ) {
          throw new Error('TRACKED_ARTIFACT_PUBLISH_FAILED')
        }
        const [rollbackOpened, rollbackCurrent] = await Promise.all([
          rollbackHandle.stat({ bigint: true }),
          lstat(rollbackPath, { bigint: true })
        ])
        if (
          !sameFileVersion(rollbackOpened, rollbackCurrent) ||
          rollbackIdentity === undefined ||
          !sameFileIdentity(rollbackIdentity, rollbackOpened) ||
          !Buffer.from(
            await readExactHandleBytes(
              rollbackHandle,
              expectedExistingBytes.byteLength
            )
          ).equals(expectedExistingBytes)
        ) {
          throw new Error('TRACKED_ARTIFACT_PUBLISH_FAILED')
        }
        const stagingCurrent = await lstat(publicationStaging.directory, {
          bigint: true
        })
        if (
          !sameFileIdentity(publicationStaging.metadata, stagingCurrent) ||
          (await realpath(publicationStaging.directory)) !==
            publicationStaging.directory
        ) {
          throw new Error('TRACKED_ARTIFACT_PUBLISH_FAILED')
        }
        await unlink(rollbackPath)
        rollbackCreated = false
        await syncDirectory(publicationStaging.directory)
        await syncDirectory(parent)
        replacementPublished = false
      }
    } finally {
      await handle.close()
    }
  } catch {
    if (publishedNewOutput && publishedNewIdentity !== undefined) {
      try {
        const [current, currentParent] = await Promise.all([
          lstat(outputPath, { bigint: true }),
          lstat(parent, { bigint: true })
        ])
        if (
          sameFileIdentity(publishedNewIdentity, current) &&
          sameFileIdentity(parentMetadata, currentParent) &&
          (await realpath(parent)) === parent
        ) {
          await unlink(outputPath)
          await syncDirectory(parent)
        }
      } catch {
        // Best-effort rollback only removes the exact inode published here.
      }
    }
    if (
      replacementPublished &&
      replacementIdentity !== undefined &&
      existingIdentity !== undefined &&
      rollbackPath !== undefined &&
      rollbackHandle !== undefined &&
      rollbackCreated
    ) {
      try {
        const [current, rollback, openedRollback] = await Promise.all([
          lstat(outputPath, { bigint: true }),
          lstat(rollbackPath, { bigint: true }),
          rollbackHandle.stat({ bigint: true })
        ])
        if (
          sameFileIdentity(replacementIdentity, current) &&
          sameFileIdentity(existingIdentity, rollback) &&
          sameFileIdentity(rollback, openedRollback) &&
          rollbackIdentity !== undefined &&
          sameFileIdentity(rollbackIdentity, openedRollback) &&
          sameFileIdentity(
            publicationStaging.metadata,
            await lstat(publicationStaging.directory, { bigint: true })
          ) &&
          (await realpath(publicationStaging.directory)) ===
            publicationStaging.directory &&
          expectedExistingBytes !== undefined &&
          expectedExistingBytes !== null
        ) {
          if (
            !Buffer.from(
              await readExactHandleBytes(
                rollbackHandle,
                expectedExistingBytes.byteLength
              )
            ).equals(expectedExistingBytes)
          ) {
            await writeExactHandleBytes(rollbackHandle, expectedExistingBytes)
          }
          const [restoredOpened, restoredPath] = await Promise.all([
            rollbackHandle.stat({ bigint: true }),
            lstat(rollbackPath, { bigint: true })
          ])
          if (
            !sameFileVersion(restoredOpened, restoredPath) ||
            !Buffer.from(
              await readExactHandleBytes(
                rollbackHandle,
                expectedExistingBytes.byteLength
              )
            ).equals(expectedExistingBytes)
          ) {
            throw new Error('TRACKED_ARTIFACT_PUBLISH_FAILED')
          }
          await rename(rollbackPath, outputPath)
          rollbackCreated = false
          replacementPublished = false
          await syncDirectory(publicationStaging.directory)
          await syncDirectory(parent)
        }
      } catch {
        // Preserve the predecessor link for explicit fail-closed recovery.
      }
    }
    throw new Error('TRACKED_ARTIFACT_PUBLISH_FAILED')
  } finally {
    const removeKnownStagingFile = async (
      candidatePath: string,
      expectedIdentity: BigIntStats | undefined
    ): Promise<void> => {
      if (expectedIdentity === undefined) return
      try {
        const [stagingCurrent, candidateCurrent] = await Promise.all([
          lstat(publicationStaging.directory, { bigint: true }),
          lstat(candidatePath, { bigint: true })
        ])
        if (
          !sameFileIdentity(publicationStaging.metadata, stagingCurrent) ||
          !sameFileIdentity(expectedIdentity, candidateCurrent) ||
          (await realpath(publicationStaging.directory)) !==
            publicationStaging.directory
        ) {
          return
        }
        await unlink(candidatePath)
        await syncDirectory(publicationStaging.directory)
      } catch {
        // Identity uncertainty preserves non-authoritative residue.
      }
    }
    if (temporaryCreated) {
      await removeKnownStagingFile(temporaryPath, temporaryIdentity)
    }
    if (
      rollbackCreated &&
      !replacementPublished &&
      rollbackPath !== undefined
    ) {
      await removeKnownStagingFile(rollbackPath, rollbackIdentity)
    }
    await rollbackHandle?.close().catch(() => undefined)
  }
}

export const writeTrackedArtifact = async (
  input: WriteTrackedArtifactInput
): Promise<void> => writeTrackedArtifactWithTestDependencies(input, {})

export interface RemoveTrackedArtifactInput {
  readonly repositoryRoot: string
  readonly repositoryPath: string
  readonly expectedBytes: Uint8Array
  readonly maximumBytes: number
}

export const removeTrackedArtifact = async ({
  repositoryRoot,
  repositoryPath,
  expectedBytes,
  maximumBytes
}: RemoveTrackedArtifactInput): Promise<void> => {
  if (
    !/^content\/[A-Za-z0-9._/-]+$/.test(repositoryPath) ||
    repositoryPath.split('/').some((part) => part === '.' || part === '..')
  ) {
    throw new Error('TRACKED_ARTIFACT_PATH_INVALID')
  }
  const canonicalRepositoryRoot = await realpath(repositoryRoot)
  const outputPath = path.resolve(canonicalRepositoryRoot, repositoryPath)
  if (!isInside(path.join(canonicalRepositoryRoot, 'content'), outputPath)) {
    throw new Error('TRACKED_ARTIFACT_PATH_INVALID')
  }
  const parent = path.dirname(outputPath)
  if ((await realpath(parent)) !== parent) {
    throw new Error('TRACKED_ARTIFACT_PARENT_INVALID')
  }
  const before = await lstat(outputPath, { bigint: true })
  const bytes = await readArtifactBytes({
    repositoryRoot: canonicalRepositoryRoot,
    filePath: repositoryPath,
    maximumBytes
  })
  const current = await lstat(outputPath, { bigint: true })
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    !sameFileIdentity(before, current) ||
    !Buffer.from(bytes).equals(expectedBytes)
  ) {
    throw new Error('TRACKED_ARTIFACT_PUBLISH_FAILED')
  }
  await unlink(outputPath)
  const directoryHandle = await open(parent, constants.O_RDONLY)
  try {
    await directoryHandle.sync()
  } finally {
    await directoryHandle.close()
  }
}
