import { createHash } from 'node:crypto'

export const hashStudyDraftSave = (canonical: string): string =>
  createHash('sha256').update(canonical).digest('hex')
