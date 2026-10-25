import migrationConfig from './prisma.migrate.config.js'

if (process.env.NODE_ENV !== 'development') {
  throw new Error('Development migrations require NODE_ENV=development.')
}

export default migrationConfig
