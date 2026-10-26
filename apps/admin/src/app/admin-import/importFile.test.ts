import { readImportFile, MAX_IMPORT_BYTES } from '@app/admin-import/importFile'
import { createInput } from '@app/admin-question/test/questionFixture'
const request = { items: [{ clientItemId: 'row-1', content: createInput }] }
const bytes = (text: string) => new TextEncoder().encode(text)
const file = (value: Uint8Array) => ({
  size: value.byteLength,
  arrayBuffer: async () => {
    const buffer = new ArrayBuffer(value.byteLength)
    new Uint8Array(buffer).set(value)
    return buffer
  }
})
it('reads canonical original JSON without normalizing away the selected request identity', async () =>
  expect(await readImportFile(file(bytes(JSON.stringify(request))))).toEqual(
    request
  ))
it.each([0, -1, MAX_IMPORT_BYTES + 1, Number.POSITIVE_INFINITY, 1.5])(
  'rejects invalid size %s before reading',
  async (size) => {
    const read = vi.fn()
    await expect(
      readImportFile({ size, arrayBuffer: read })
    ).rejects.toMatchObject({ kind: 'SIZE' })
    expect(read).not.toHaveBeenCalled()
  }
)
it('accepts the exact 2MiB limit and refuses actual oversized or inconsistent buffers', async () => {
  const text = JSON.stringify(request)
  const exact = bytes(text + ' '.repeat(MAX_IMPORT_BYTES - bytes(text).length))
  expect((await readImportFile(file(exact))).items).toHaveLength(1)
  await expect(
    readImportFile({ ...file(new Uint8Array(MAX_IMPORT_BYTES + 1)), size: 1 })
  ).rejects.toMatchObject({ kind: 'SIZE' })
  await expect(
    readImportFile({ ...file(bytes(text)), size: 1 })
  ).rejects.toMatchObject({ kind: 'FORMAT' })
})
it.each([
  '{"items":[],"items":' + JSON.stringify(request.items) + '}',
  '{"items":[],"it\\u0065ms":' + JSON.stringify(request.items) + '}',
  '{"items":[]} trailing',
  '[]',
  '{"items":[]}',
  '{"items":null}',
  '{"items":[],"extra":true}'
])('rejects strict JSON/schema violation %s', async (text) => {
  await expect(readImportFile(file(bytes(text)))).rejects.toMatchObject({
    kind: 'FORMAT'
  })
})
it('rejects malformed UTF8 and unreadable files without exposing parser exceptions', async () => {
  await expect(
    readImportFile(file(new Uint8Array([0xc3, 0x28])))
  ).rejects.toMatchObject({ kind: 'FORMAT' })
  await expect(
    readImportFile({
      size: 1,
      arrayBuffer: async () => {
        throw new Error('private file path')
      }
    })
  ).rejects.toMatchObject({ kind: 'FORMAT', message: 'FORMAT' })
})
it('requires the existing shared item/content shape and at most 100 items', async () => {
  await expect(
    readImportFile(
      file(
        bytes(
          JSON.stringify({
            items: Array.from({ length: 101 }, (_, i) => ({
              ...request.items[0],
              clientItemId: String(i)
            }))
          })
        )
      )
    )
  ).rejects.toMatchObject({ kind: 'FORMAT' })
  await expect(
    readImportFile(
      file(
        bytes(
          JSON.stringify({
            items: [
              {
                clientItemId: 'row-1',
                content: { ...createInput, options: [] }
              }
            ]
          })
        )
      )
    )
  ).rejects.toMatchObject({ kind: 'FORMAT' })
})
