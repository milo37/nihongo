export const serverStateQueryKeys = {
  study: {
    all: () => ['study'] as const,
    sessions: () => ['study', 'sessions'] as const,
    session: (sessionId: string) =>
      ['study', 'sessions', 'get-session', sessionId] as const,
    draft: (sessionId: string) =>
      ['study', 'sessions', sessionId, 'draft'] as const,
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
    all: () => ['wrong-note'] as const
  },
  dashboard: {
    all: () => ['dashboard'] as const
  }
} as const
