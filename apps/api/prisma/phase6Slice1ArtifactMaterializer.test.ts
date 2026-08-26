import {
  chmod,
  lstat,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { writeJson, writeJsonSet } from './phase6Slice1ArtifactMaterializer.js'

const temporaryRoots: string[] = []

const createTemporaryRoot = async (): Promise<string> => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), 'nihongo-slice1-materializer-')
  )
  temporaryRoots.push(root)
  await chmod(root, 0o700)
  return root
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { force: true, recursive: true }))
  )
})

describe('Phase 6 Slice 1 immutable legacy materialization', () => {
  it('preserves an equivalent existing artifact and rejects semantic drift', async () => {
    const repositoryRoot = await createTemporaryRoot()
    const repositoryPath =
      'content/releases/legacy-system-seed-v1/1/legacy-seed-manifest.json'
    const value = { schemaVersion: 1, itemCount: 65 }
    await writeJson(repositoryRoot, repositoryPath, value)

    const outputPath = path.join(repositoryRoot, repositoryPath)
    expect((await lstat(outputPath)).mode & 0o777).toBe(0o644)
    const formattedBytes = Buffer.from(
      '{\n  "schemaVersion": 1,\n  "itemCount": 65\n}\n',
      'utf8'
    )
    await writeFile(outputPath, formattedBytes, { mode: 0o644 })
    const before = await lstat(outputPath, { bigint: true })
    await writeJson(repositoryRoot, repositoryPath, value)
    const after = await lstat(outputPath, { bigint: true })
    expect(await readFile(outputPath)).toEqual(formattedBytes)
    expect({ dev: after.dev, ino: after.ino }).toEqual({
      dev: before.dev,
      ino: before.ino
    })

    await expect(
      writeJson(repositoryRoot, repositoryPath, {
        schemaVersion: 1,
        itemCount: 64
      })
    ).rejects.toThrow('PHASE6_IMMUTABLE_ARTIFACT_DRIFT')
    expect(await readFile(outputPath)).toEqual(formattedBytes)
  })

  it('preflights every output before publishing a missing artifact', async () => {
    const repositoryRoot = await createTemporaryRoot()
    const existingPath = 'content/taxonomy/tags.v1.json'
    await writeJson(repositoryRoot, existingPath, {
      schemaVersion: 1,
      taxonomyVersion: 'first'
    })

    const missingPath = 'content/coverage/internal-beta.v1.json'
    await expect(
      writeJsonSet(repositoryRoot, [
        {
          relativePath: existingPath,
          value: { schemaVersion: 1, taxonomyVersion: 'changed' }
        },
        {
          relativePath: missingPath,
          value: { schemaVersion: 1, coverageVersion: 'first' }
        }
      ])
    ).rejects.toThrow('PHASE6_IMMUTABLE_ARTIFACT_DRIFT')
    await expect(
      readFile(path.join(repositoryRoot, missingPath))
    ).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
