export const serverStateQueryKeys = {
  study: {
    all: () => ['study'] as const,
    session: (sessionId: string) =>
      ['study', 'get-session', sessionId] as const,
    result: (sessionId: string) => ['study', 'get-result', sessionId] as const
  },
  wrongNote: {
    all: () => ['wrong-note'] as const
  },
  dashboard: {
    all: () => ['dashboard'] as const
  }
} as const
