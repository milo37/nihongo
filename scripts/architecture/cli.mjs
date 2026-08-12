#!/usr/bin/env node
import { checkArchitecture, formatArchitectureDiagnostic } from './checker.mjs'

const diagnostics = checkArchitecture()

if (diagnostics.length === 0) {
  console.log('Architecture check passed.')
  process.exit(0)
}

for (const diagnostic of diagnostics) {
  console.error(formatArchitectureDiagnostic(diagnostic))
}

console.error(
  `Architecture check failed with ${diagnostics.length} violation(s).`
)
process.exit(1)
