#!/usr/bin/env node
import { checkArchitecture, formatArchitectureDiagnostic } from './checker.mjs'
import {
  checkWorkspaceArchitecture,
  formatWorkspaceDiagnostic
} from './workspace-checker.mjs'

const diagnostics = checkArchitecture()
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
