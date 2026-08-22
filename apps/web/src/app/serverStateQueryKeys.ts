export const serverStateQueryKeys = {
  study: {
    all: () => ['study'] as const,
    sessions: () => ['study', 'sessions'] as const,
    session: (sessionId: string) =>
      ['study', 'sessions', 'get-session', sessionId] as const,
    draft: (sessionId: string) =>
      ['study', 'sessions', sessionId, 'draft'] as const,
    resumableSessions: () => ['study', 'sessions', 'resumable'] as const,
    resumable: (params: { page: number; pageSize: number }) =>
      [
        'study',
        'sessions',
        'resumable',
        { page: params.page, pageSize: params.pageSize }
      ] as const,
    result: (sessionId: string) => ['study', 'get-result', sessionId] as const
  },
  wrongNote: {
    all: () => ['wrong-note'] as const,
    historicalLists: () => ['wrong-note', 'historical-list'] as const,
    details: () => ['wrong-note', 'detail'] as const,
    detail: (questionId: string) =>
      ['wrong-note', 'detail', questionId] as const,
    reviewQueues: () => ['wrong-note', 'review-queue'] as const,
    memos: () => ['wrong-note', 'memo'] as const,
    memo: (questionId: string) => ['wrong-note', 'memo', questionId] as const,
    reviewEvents: () => ['wrong-note', 'review-events'] as const,
    reviewEventConnection: (questionId: string, pageSize: number) =>
      ['wrong-note', 'review-events', questionId, { pageSize }] as const
  },
  dashboard: {
    all: () => ['dashboard'] as const
  }
} as const
