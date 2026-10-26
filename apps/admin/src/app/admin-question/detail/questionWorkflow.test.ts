import * as api from '@nihongo/browser/api/phase7/requestPhase7Operation'
import { describe, it, expect, vi } from 'vitest'
import {
  allowedCommands,
  buildQuestionCommand,
  editableVersion,
  editorInput
} from '@app/admin-question/detail/questionWorkflow'
import {
  initial,
  newer,
  older,
  actorId,
  reviewerId,
  reviewer,
  previewFor,
  versionId,
  oldVersionId,
  questionId
} from '@app/admin-question/test/workflowFixture'
import { questionWorkflowQueries } from '@app/admin-question/queries/questionWorkflowQueries'
describe('question workflow permission and CAS snapshot', () => {
  it('preserves author editing and separation of duties', () => {
    expect(editableVersion(initial, newer, actorId)).toBe(true)
    expect(editableVersion(initial, newer, reviewerId)).toBe(false)
    expect(allowedCommands(initial, newer, actorId, newer)).toEqual([
      'ARCHIVE',
      'REQUEST_REVIEW'
    ])
    const inReview = { ...newer, versionStatus: 'IN_REVIEW' as const }
    expect(allowedCommands(initial, inReview, actorId, inReview)).toEqual([
      'ARCHIVE'
    ])
    expect(allowedCommands(initial, inReview, reviewerId, inReview)).toEqual([
      'ARCHIVE',
      'CHANGE_REQUEST',
      'APPROVE'
    ])
    const approved = {
      ...newer,
      versionStatus: 'APPROVED' as const,
      latestReviewer: reviewer
    }
    expect(allowedCommands(initial, approved, reviewerId, approved)).toEqual([
      'ARCHIVE',
      'WITHDRAW',
      'PUBLISH'
    ])
    expect(
      allowedCommands(
        {
          ...initial,
          question: { ...initial.question, lifecycleStatus: 'ARCHIVED' }
        },
        approved,
        actorId
      )
    ).toEqual([])
  })
  it('requires the candidate snapshot before archive and allows new draft only without a candidate', () => {
    expect(allowedCommands(initial, newer, actorId)).not.toContain('ARCHIVE')
    const noCandidate = {
      ...initial,
      question: { ...initial.question, openCandidateVersionId: null }
    }
    expect(allowedCommands(noCandidate, older, actorId)).toEqual([
      'CREATE_VERSION',
      'ARCHIVE',
      'RETIRE'
    ])
    expect(() =>
      buildQuestionCommand(
        'ARCHIVE',
        initial,
        newer,
        previewFor(),
        '',
        undefined
      )
    ).toThrow()
  })
  it.each(['PUBLISH', 'RETIRE'] as const)(
    'sends both viewed CAS versions for %s',
    (command) => {
      const request = buildQuestionCommand(
        command,
        { ...initial, question: { ...initial.question, rowVersion: 7 } },
        { ...newer, rowVersion: 4 },
        previewFor(),
        '',
        newer
      )
      expect(request.body).toEqual({
        expectedRowVersion: 4,
        expectedQuestionRowVersion: 7
      })
      expect(request.params).toEqual({ versionId })
    }
  )
  it('uses the actual open candidate in archive CAS even if viewing another version', () => {
    expect(
      buildQuestionCommand(
        'ARCHIVE',
        initial,
        older,
        previewFor(oldVersionId),
        '',
        newer
      ).body
    ).toEqual({
      expectedQuestionRowVersion: 1,
      expectedOpenCandidateVersionId: versionId,
      expectedOpenCandidateRowVersion: 1
    })
  })
  it('copies the selected preview into a new original draft and retains correct-option identity', () => {
    const request = buildQuestionCommand(
      'CREATE_VERSION',
      {
        ...initial,
        question: { ...initial.question, openCandidateVersionId: null }
      },
      older,
      previewFor(oldVersionId),
      ''
    )
    expect(request.operation).toBe('createAdminQuestionVersion')
    expect(request.body).toMatchObject({
      expectedQuestionRowVersion: 1,
      questionText: 'Older question',
      correctOptionKey: 'option-1'
    })
    expect(editorInput(previewFor(), 5)).toMatchObject({
      expectedRowVersion: 5,
      correctOptionId: previewFor().adminAnswer.correctOptionId
    })
  })
  it('validates required reason and Unicode scalar limits before dispatch', () => {
    expect(() =>
      buildQuestionCommand('WITHDRAW', initial, newer, previewFor(), '')
    ).toThrow()
    expect(() =>
      buildQuestionCommand(
        'CHANGE_REQUEST',
        initial,
        newer,
        previewFor(),
        'x'.repeat(101)
      )
    ).toThrow()
    expect(
      buildQuestionCommand(
        'CHANGE_REQUEST',
        initial,
        newer,
        previewFor(),
        '😀'.repeat(100)
      ).body
    ).toMatchObject({ reason: '😀'.repeat(100) })
    expect(
      buildQuestionCommand('APPROVE', initial, newer, previewFor(), 'checked')
        .body
    ).toEqual({ expectedRowVersion: 1, comment: 'checked' })
    expect(
      buildQuestionCommand('REQUEST_REVIEW', initial, newer, previewFor(), '')
        .body
    ).toEqual({ expectedRowVersion: 1 })
  })
  it('separates private query caches by actor, epoch, selected version and rowVersion', () => {
    const key = questionWorkflowQueries.preview(
      actorId,
      1,
      questionId,
      versionId,
      1
    ).queryKey
    expect(key).not.toEqual(
      questionWorkflowQueries.preview(reviewerId, 1, questionId, versionId, 1)
        .queryKey
    )
    expect(key).not.toEqual(
      questionWorkflowQueries.preview(actorId, 2, questionId, versionId, 1)
        .queryKey
    )
    expect(key).not.toEqual(
      questionWorkflowQueries.preview(actorId, 1, questionId, oldVersionId, 1)
        .queryKey
    )
    expect(key).not.toEqual(
      questionWorkflowQueries.preview(actorId, 1, questionId, versionId, 2)
        .queryKey
    )
  })
})

it('rejects a valid selected-version preview belonging to another question', async () => {
  const endpoint = vi.spyOn(api, 'requestPhase7Operation').mockResolvedValue({
    ...previewFor(),
    question: { ...previewFor().question, id: reviewerId }
  })
  const options = questionWorkflowQueries.preview(
    actorId,
    1,
    questionId,
    versionId,
    1
  )
  await expect(
    options.queryFn!({} as Parameters<NonNullable<typeof options.queryFn>>[0])
  ).rejects.toMatchObject({
    isResponseValidationError: true,
    retryable: false,
    status: 422
  })
  endpoint.mockRestore()
})
