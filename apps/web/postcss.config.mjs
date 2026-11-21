import process from 'node:process'

// Tells the shared Tailwind config to scan only the learner app's sources.
process.env.NIHONGO_TAILWIND_APP = 'web'

export default {
  plugins: {
    '@tailwindcss/postcss': {}
  }
}
