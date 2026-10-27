export const assertBrowserBuildGraph: (
  artifact: 'web' | 'admin',
  modules: string[]
) => void
export const assertBrowserArtifact: (
  artifact: 'web' | 'admin',
  directory: string
) => { artifact: string; releaseId: string; files: number; modules: number }
