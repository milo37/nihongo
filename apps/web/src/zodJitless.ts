import { config } from 'zod/v4'

// vite.config.ts points every `zod` import here, so this runs after zod
// loads and before any schema is built. Without it zod probes eval with
// Function('') on the first z.object, and the CSP (script-src 'self')
// reports it. A config call in main.tsx runs too late: Rollup evaluates
// the shared chunk holding the schemas before the entry body.
config({ jitless: true })

export * from 'zod/v4'
export { default } from 'zod/v4'
