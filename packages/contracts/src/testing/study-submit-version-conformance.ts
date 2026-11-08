interface StudySubmitConformanceAnswer {
  readonly studySessionQuestionId: string
  readonly selectedOptionId: string | null
  readonly elapsedSec: number
}

interface StudySubmitVersionConformanceFixture {
  readonly sessionId: string
  readonly orderedSessionQuestionIds: readonly string[]
  readonly answers: readonly StudySubmitConformanceAnswer[]
  readonly durationSec: number
  readonly v1CanonicalMaterial: string
  readonly v1Sha256: string
  readonly v2CanonicalMaterial: string
  readonly v2Sha256: string
}

// v2 material has no draft revision: submit grades the answers as sent.
export const studySubmitVersionConformanceFixture = {
  sessionId: '018f6b7a-1f4b-7d5e-8a91-000000000001',
  orderedSessionQuestionIds: [
    '018f6b7a-1f4b-7d5e-8a91-000000000002',
    '018f6b7a-1f4b-7d5e-8a91-000000000003'
  ],
  answers: [
    {
      studySessionQuestionId: '018f6b7a-1f4b-7d5e-8a91-000000000002',
      selectedOptionId: '018f6b7a-1f4b-7d5e-8a91-000000000012',
      elapsedSec: 10
    },
    {
      studySessionQuestionId: '018f6b7a-1f4b-7d5e-8a91-000000000003',
      selectedOptionId: null,
      elapsedSec: 20
    }
  ],
  durationSec: 30,
  v1CanonicalMaterial:
    'submit-v1:{"sessionId":"018f6b7a-1f4b-7d5e-8a91-000000000001","answers":[{"studySessionQuestionId":"018f6b7a-1f4b-7d5e-8a91-000000000002","selectedOptionId":"018f6b7a-1f4b-7d5e-8a91-000000000012","elapsedSec":10},{"studySessionQuestionId":"018f6b7a-1f4b-7d5e-8a91-000000000003","selectedOptionId":null,"elapsedSec":20}],"durationSec":30}',
  v1Sha256: '07b379a47170de83026bbb7f0053722d219549dc599dbb78581aa62d5d4d148a',
  v2CanonicalMaterial:
    'submit-v2:{"sessionId":"018f6b7a-1f4b-7d5e-8a91-000000000001","answers":[{"studySessionQuestionId":"018f6b7a-1f4b-7d5e-8a91-000000000002","selectedOptionId":"018f6b7a-1f4b-7d5e-8a91-000000000012","elapsedSec":10},{"studySessionQuestionId":"018f6b7a-1f4b-7d5e-8a91-000000000003","selectedOptionId":null,"elapsedSec":20}],"durationSec":30}',
  v2Sha256: '7b8e442ced57eeb7e40a445fcf59bd0303a13dafe108333282719a4de571d4da'
} as const satisfies StudySubmitVersionConformanceFixture
