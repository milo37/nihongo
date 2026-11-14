import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  createOperatorAdminAuthority,
  operatorActorOf
} from './operatorAdminAuthority.js'

const sourceRoot = fileURLToPath(new URL('..', import.meta.url))

const sourceFiles = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name)
      if (entry.isDirectory())
        return entry.name === 'generated' ? [] : sourceFiles(path)
      return /\.ts$/u.test(entry.name) && !/\.test\.ts$/u.test(entry.name)
        ? [path]
        : []
    })
  )
  return files.flat()
}

describe('operator admin authority (JLP-828)', () => {
  it('is only made by the content operator commands, never over HTTP', async () => {
    const makers: string[] = []
    const commandImporters: string[] = []
    for (const file of await sourceFiles(sourceRoot)) {
      const source = await readFile(file, 'utf8')
      const path = relative(sourceRoot, file)
      if (source.includes('createOperatorAdminAuthority')) makers.push(path)
      if (
        /from '[./]*\/?content\/(questionSet|explanationJa)Publish(Command)?\.js'/u.test(
          source
        )
      )
        commandImporters.push(path)
    }
    expect(makers.toSorted()).toEqual([
      'admin/operatorAdminAuthority.ts',
      'content/explanationJaPublish.ts',
      'content/questionSetPublish.ts'
    ])
    // Nothing in the server, its routes or middleware reaches the command.
    expect(commandImporters).toEqual([])
  })

  it('marks only the objects it made', () => {
    const authority = createOperatorAdminAuthority({
      actorId: 'actor',
      requestId: 'run'
    })
    expect(operatorActorOf(authority)).toBe('actor')
    expect(authority.rawSessionToken).toBe('')
    expect(
      operatorActorOf({
        actorId: 'actor',
        rawSessionToken: '',
        requestId: 'run'
      })
    ).toBeNull()
  })
})
