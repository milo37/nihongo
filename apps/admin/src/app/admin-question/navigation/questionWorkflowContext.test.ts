import { cachedSessionStorage } from '@nihongo/browser/libs/storage'
import { safeSsoReturnPath } from '@nihongo/contracts/auth/sign-in-social'
import {
  saveQuestionFreshContext,
  readQuestionFreshContext,
  discardQuestionFreshContext,
  safeQuestionReturn
} from '@app/admin-question/navigation/questionWorkflowContext'
import {
  actorId,
  reviewerId,
  questionId,
  versionId
} from '@app/admin-question/test/workflowFixture'
const context = {
  actorId,
  questionId,
  versionId,
  questionRowVersion: 3,
  versionRowVersion: 2,
  openCandidateVersionId: null,
  openCandidateRowVersion: null,
  returnTo: '/admin/questions?level=N3&page=2',
  command: 'WITHDRAW' as const,
  note: 'check <script>plain</script>'
}
afterEach(() => {
  discardQuestionFreshContext(actorId, questionId)
  vi.restoreAllMocks()
})
it('preserves only scoped selection/CAS/note/list context for explicit fresh, with no replay payload or auth secrets', () => {
  expect(saveQuestionFreshContext(context)).toBe(true)
  expect(readQuestionFreshContext(actorId, questionId)).toEqual(context)
  expect(readQuestionFreshContext(reviewerId, questionId)).toBeNull()
  expect(readQuestionFreshContext(actorId, versionId)).toBeNull()
  expect(
    Object.keys(readQuestionFreshContext(actorId, questionId)!).sort()
  ).toEqual(Object.keys(context).sort())
  expect(safeSsoReturnPath('/admin/questions/' + questionId)).toBe(
    '/admin/questions/' + questionId
  )
  discardQuestionFreshContext(actorId, questionId)
  expect(readQuestionFreshContext(actorId, questionId)).toBeNull()
})
it.each([
  'https://evil.test/admin/questions',
  '/admin/reports',
  '//evil.test/admin/questions',
  '/admin/questions?level=N3&level=N2',
  '/admin/questions#secret'
])('rejects unsafe list return %s', (value) =>
  expect(safeQuestionReturn(value)).toBe('/admin/questions')
)
it('refuses fresh navigation handoff if local storage cannot preserve valid context', () => {
  vi.spyOn(cachedSessionStorage, 'setItem').mockReturnValue(false)
  expect(saveQuestionFreshContext(context)).toBe(false)
  expect(saveQuestionFreshContext({ ...context, actorId: 'invalid' })).toBe(
    false
  )
})

it('regression: round-trips the actual candidate identity and rowVersion for ARCHIVE fresh confirmation', () => {
  const archive = {
    ...context,
    command: 'ARCHIVE' as const,
    openCandidateVersionId: versionId,
    openCandidateRowVersion: 4
  }
  expect(saveQuestionFreshContext(archive)).toBe(true)
  expect(readQuestionFreshContext(actorId, questionId)).toEqual(archive)
})
it('regression: rejects an incomplete candidate CAS pair', () => {
  const incomplete = {
    ...context,
    openCandidateVersionId: versionId,
    openCandidateRowVersion: null
  }
  expect(saveQuestionFreshContext(incomplete)).toBe(false)
  expect(readQuestionFreshContext(actorId, questionId)).toBeNull()
})
it('regression: reads legacy non-ARCHIVE context with an explicit null candidate pair', () => {
  const stored = vi.spyOn(cachedSessionStorage, 'setItem')
  expect(saveQuestionFreshContext(context)).toBe(true)
  const storageKey = stored.mock.calls[0]![0]
  const {
    openCandidateVersionId: _candidate,
    openCandidateRowVersion: _row,
    ...legacy
  } = context
  cachedSessionStorage.setItem(storageKey, JSON.stringify(legacy))
  expect(readQuestionFreshContext(actorId, questionId)).toEqual({
    ...context,
    openCandidateVersionId: null,
    openCandidateRowVersion: null
  })
})
