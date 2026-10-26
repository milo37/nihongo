import fs from 'node:fs'
import path from 'node:path'
import { checkArchitecture, formatArchitectureDiagnostic } from './checker.mjs'
import {
  checkWorkspaceArchitecture,
  formatWorkspaceDiagnostic
} from './workspace-checker.mjs'

const diagnostics = checkArchitecture()
for (const directory of ['apps/admin', 'packages/browser']) {
  const root = path.resolve(import.meta.dirname, '../..', directory)
  if (!fs.existsSync(path.join(root, 'src'))) continue
  diagnostics.push(
    ...checkArchitecture({
      tsconfigPath: path.join(root, 'tsconfig.json'),
      sourceRoot: path.join(root, 'src'),
      allowRelativeImports: directory === 'packages/browser'
    })
  )
}
const workspaceDiagnostics = checkWorkspaceArchitecture()

if (diagnostics.length === 0 && workspaceDiagnostics.length === 0) {
  console.log('Architecture check passed.')
  process.exit(0)
}

for (const diagnostic of diagnostics) {
  console.error(formatArchitectureDiagnostic(diagnostic))
}

for (const diagnostic of workspaceDiagnostics) {
  console.error(formatWorkspaceDiagnostic(diagnostic))
}

console.error(
  `Architecture check failed with ${diagnostics.length + workspaceDiagnostics.length} violation(s).`
)
process.exit(1)
