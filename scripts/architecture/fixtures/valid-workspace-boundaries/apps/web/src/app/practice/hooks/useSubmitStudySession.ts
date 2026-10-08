export const useSubmitStudySession = () => ({
  mutationFn: async () => {
    const { parseSubmission } = await import(
      '@app/practice/commands/submitStudySessionCommand'
    )

    return parseSubmission
  }
})
