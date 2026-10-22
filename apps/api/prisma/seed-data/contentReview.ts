export const QUESTION_CONTENT_REVIEW = {
  sourceType: 'ORIGINAL',
  questionCount: 65,
  reviewedAt: '2026-08-14',
  reviewScope: [
    '실제 JLPT 기출·교재 문항을 복제하지 않은 자체 제작 더미 데이터',
    '급수·과목 분포, 정답 단일성, 해설, 태그, 독해 지문',
    '명백한 일본어 문법 오류와 문제 유형 일치'
  ],
  itemRevisions: [
    {
      questionId: 'n5-vocabulary-02',
      revision: 'JLP-34-revision2',
      reviewedAt: '2026-10-05',
      reviewScope:
        'JLP-35 독립 의미 검수 채택 및 JLP-36 동일 ID 교체 중복 검수',
      limitations:
        '외부 교육감수·권리·실제 표시·비용은 미검증; 다른 64문항 재검수 아님'
    }
  ],
  sha256: '91c492f5a59142c71c923d066d1863afbda3b1b6e0e78a7b2f89411ec4303ad2'
} as const
