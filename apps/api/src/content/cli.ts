import {
  classifyCommandFailure,
  emitCommandFailure
} from './commands/v1/commandSupport.js'
import {
  runAuthorPrepare,
  runCoverage,
  runContentCheck,
  runDuplicates,
  runLegacyPolicyFinalize,
  runLegacyPolicyPrepare,
  runPolicyFinalize,
  runPolicyPrepare,
  runPolicyActivationFinalize,
  runPolicyActivationPrepare,
  runReviewCheck,
  runReviewPrepare,
  runValidate
} from './commands/v1/commands.js'
import { assertRetainedRuntime } from './validators/v1/retainedRuntime.js'

const commands: Readonly<
  Record<string, (args: readonly string[]) => Promise<void>>
> = {
  'author-prepare': runAuthorPrepare,
  check: runContentCheck,
  coverage: runCoverage,
  duplicates: runDuplicates,
  'legacy-policy-finalize': runLegacyPolicyFinalize,
  'legacy-policy-prepare': runLegacyPolicyPrepare,
  'policy-finalize': runPolicyFinalize,
  'policy-prepare': runPolicyPrepare,
  'policy-activation-finalize': runPolicyActivationFinalize,
  'policy-activation-prepare': runPolicyActivationPrepare,
  'review-check': runReviewCheck,
  'review-prepare': runReviewPrepare,
  validate: runValidate
}

const main = async (): Promise<void> => {
  await assertRetainedRuntime()
  const [command, ...args] = process.argv.slice(2)
  const run = command === undefined ? undefined : commands[command]
  if (!run) throw new Error('CONTENT_COMMAND_UNKNOWN')
  await run(args)
}

main().catch((error: unknown) => {
  const failure = classifyCommandFailure(error)
  emitCommandFailure(failure)
  process.exitCode = failure.exitCode
})
