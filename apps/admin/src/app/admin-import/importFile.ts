import {
  parseJsonBytes,
  validateQuestionImportRequestSchema,
  type ValidateQuestionImportRequest
} from '@nihongo/contracts/admin/content-operations'
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024
export class ImportFileError extends Error {
  constructor(readonly kind: 'SIZE' | 'FORMAT') {
    super(kind)
    this.name = 'ImportFileError'
  }
}
export const readImportFile = async (
  file: Pick<File, 'size' | 'arrayBuffer'>
): Promise<ValidateQuestionImportRequest> => {
  if (
    !Number.isSafeInteger(file.size) ||
    file.size <= 0 ||
    file.size > MAX_IMPORT_BYTES
  )
    throw new ImportFileError('SIZE')
  try {
    const bytes = new Uint8Array(await file.arrayBuffer())
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMPORT_BYTES)
      throw new ImportFileError('SIZE')
    if (bytes.byteLength !== file.size) throw new ImportFileError('FORMAT')
    return validateQuestionImportRequestSchema.parse(parseJsonBytes(bytes))
  } catch (error) {
    if (error instanceof ImportFileError) throw error
    throw new ImportFileError('FORMAT')
  }
}
