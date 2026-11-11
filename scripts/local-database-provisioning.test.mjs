import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
)

const groupRoles = [
  'nihongo_owner',
  'nihongo_migration',
  'nihongo_app',
  'nihongo_guest_cleanup_worker'
]

const wrapperRoles = [
  {
    name: 'nihongo_test_migration_login',
    grantedRole: 'nihongo_migration'
  },
  { name: 'nihongo_test_app_login', grantedRole: 'nihongo_app' },
  {
    name: 'nihongo_test_guest_cleanup_worker_login',
    grantedRole: 'nihongo_guest_cleanup_worker'
  },
  {
    name: 'nihongo_development_migration_login',
    grantedRole: 'nihongo_migration'
  },
  { name: 'nihongo_development_app_login', grantedRole: 'nihongo_app' },
  {
    name: 'nihongo_development_guest_cleanup_worker_login',
    grantedRole: 'nihongo_guest_cleanup_worker'
  }
]

const removedRoles = [
  'nihongo_auth_gateway',
  'nihongo_erasure_worker',
  'auth_gateway_login',
  'erasure_worker_login',
  'legacy_app_login'
]

const secretNames = [
  'TEST_MIGRATION_PASSWORD',
  'TEST_APP_PASSWORD',
  'TEST_GUEST_CLEANUP_WORKER_PASSWORD',
  'DEVELOPMENT_MIGRATION_PASSWORD',
  'DEVELOPMENT_APP_PASSWORD',
  'DEVELOPMENT_GUEST_CLEANUP_WORKER_PASSWORD'
]

const removedSecretNames = [
  'TEST_AUTH_GATEWAY_PASSWORD',
  'TEST_ERASURE_WORKER_PASSWORD',
  'TEST_LEGACY_APP_PASSWORD',
  'DEVELOPMENT_AUTH_GATEWAY_PASSWORD',
  'DEVELOPMENT_ERASURE_WORKER_PASSWORD',
  'DEVELOPMENT_LEGACY_APP_PASSWORD'
]

const migrationPaths = [
  'apps/api/prisma/migrations/20261105090000_baseline/migration.sql',
  'apps/api/prisma/migrations/20261106090000_remove_phase_names/migration.sql',
  'apps/api/prisma/migrations/20261107090000_first_admin_production/migration.sql',
  'apps/api/prisma/migrations/20261108090000_remove_tag_applicability_and_snapshots/migration.sql',
  'apps/api/prisma/migrations/20261109090000_add_tag_key_subject_status/migration.sql',
  'apps/api/prisma/migrations/20261110090000_admin_fresh_window_30_minutes/migration.sql',
  'apps/api/prisma/migrations/20261111090000_grant_user_target_level_update/migration.sql'
]

const readRepositoryFile = async (relativePath) =>
  await readFile(path.join(repositoryRoot, relativePath), 'utf8')

const parseDotenvExample = (source) =>
  new Map(
    source
      .split('\n')
      .filter((line) => line.length > 0 && !line.startsWith('#'))
      .map((line) => {
        const separator = line.indexOf('=')
        assert.notEqual(separator, -1, `Malformed dotenv example line: ${line}`)
        return [line.slice(0, separator), line.slice(separator + 1)]
      })
  )

const normalizeEdges = (edges) =>
  edges
    .map(([grantedRole, memberRole]) => `${memberRole}->${grantedRole}`)
    .sort()

test('Compose isolates persistent local roles from disposable runners', async () => {
  const compose = await readRepositoryFile('compose.yaml')
  const createTestDatabase = await readRepositoryFile(
    'infra/postgres/init/01-create-test-database.sql'
  )
  assert.equal(createTestDatabase.trim(), 'CREATE DATABASE nihongo_test;')

  assert.match(compose, /postgres:\n[\s\S]*LOCAL_DATABASE_PROVISIONING: '0'/u)
  assert.match(
    compose,
    /postgres-local:\n[\s\S]*profiles: \['local-db'\][\s\S]*LOCAL_DATABASE_PROVISIONING: '1'/u
  )
  assert.match(compose, /127\.0\.0\.1:\$\{LOCAL_POSTGRES_PORT:-55433\}:5432/u)
  assert.match(compose, /nihongo-local-postgres-data:\/var\/lib\/postgresql/u)
  assert.match(compose, /\.nihongo-local-provisioned/u)
  assert.doesNotMatch(compose, /phase/iu)

  for (const secretName of secretNames) {
    const interpolation = '${' + secretName + ':-}'
    assert.ok(compose.includes(`${secretName}: ${interpolation}`))
  }
  for (const secretName of removedSecretNames) {
    assert.equal(compose.includes(secretName), false)
  }
})

test('fresh init matches the canonical local database role graph', async () => {
  const init = await readRepositoryFile(
    'infra/postgres/init/02-provision-local-database.sh'
  )
  const migrations = (
    await Promise.all(migrationPaths.map(readRepositoryFile))
  ).join('\n')
  const createdRoles = [...init.matchAll(/^CREATE ROLE "([^"]+)"/gmu)].map(
    (match) => match[1]
  )
  const expectedRoles = [...groupRoles, ...wrapperRoles.map(({ name }) => name)]

  assert.deepEqual(createdRoles.sort(), expectedRoles.sort())
  assert.match(init, /LOCAL_DATABASE_PROVISIONING:-0.*!= '1'/u)
  assert.match(init, /POSTGRES_DB must be the canonical nihongo_dev/u)
  assert.match(init, /bootstrap and wrapper secrets must all be distinct/u)
  assert.match(init, /\$role_attestation\$/u)
  assert.match(init, /exact_group_count <> 4/u)
  assert.match(init, /exact_wrapper_count <> 6/u)
  assert.match(init, /expected_membership_count <> 7/u)
  assert.doesNotMatch(init, /phase/iu)
  assert.match(init, /unexpected_membership_count <> 0/u)

  for (const role of groupRoles) {
    assert.match(
      init,
      new RegExp(
        `CREATE ROLE "${role}"\\s+` +
          'NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE\\s+' +
          'NOREPLICATION NOBYPASSRLS;'
      )
    )
    assert.match(migrations, new RegExp(role))
  }
  for (const role of removedRoles) {
    assert.equal(init.includes(role), false, role)
  }

  for (const { name } of wrapperRoles) {
    assert.match(
      init,
      new RegExp(
        `CREATE ROLE "${name}"\\s+` +
          'LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE\\s+' +
          "NOREPLICATION NOBYPASSRLS PASSWORD :'[^']+';"
      )
    )
    assert.match(init, new RegExp(`'${name}'`))
  }

  const actualEdges = [
    ...init.matchAll(
      /^GRANT "([^"]+)" TO "([^"]+)"\n\s+WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;/gmu
    )
  ].map((match) => [match[1], match[2]])
  const expectedEdges = [
    ['nihongo_owner', 'nihongo_migration'],
    ...wrapperRoles.flatMap(({ grantedRole, name }) =>
      grantedRole ? [[grantedRole, name]] : []
    )
  ]

  assert.deepEqual(normalizeEdges(actualEdges), normalizeEdges(expectedEdges))
  assert.equal(actualEdges.length, 7)
})

test('fresh init owns and attests both canonical local databases', async () => {
  const init = await readRepositoryFile(
    'infra/postgres/init/02-provision-local-database.sh'
  )

  assert.match(init, /for database_name in nihongo_dev nihongo_test/u)
  assert.match(init, /CREATE EXTENSION pgcrypto WITH SCHEMA public;/u)
  assert.match(init, /ALTER SCHEMA public OWNER TO "nihongo_migration";/u)
  assert.match(
    init,
    /ALTER DATABASE :"target_database" OWNER TO "nihongo_migration";/u
  )
  assert.match(
    init,
    /REVOKE ALL PRIVILEGES ON DATABASE :"target_database" FROM PUBLIC;/u
  )
  assert.match(
    init,
    /GRANT CREATE, TEMPORARY ON DATABASE :"target_database"\s+TO "nihongo_migration";/u
  )
  assert.match(
    init,
    /GRANT CONNECT ON DATABASE :"target_database"\s+TO :"migration_login", :"app_login", :"guest_cleanup_login";/u
  )
  assert.match(init, /\$local_attestation\$/u)
  assert.match(init, /unexpected_acl_count <> 0 OR missing_acl_count <> 0/u)
  assert.match(init, /touch "\$PGDATA\/\.nihongo-local-provisioned"/u)
})

test('dotenv examples keep technical and runner targets separate', async () => {
  const rootEnvironment = parseDotenvExample(
    await readRepositoryFile('.env.example')
  )
  const developmentEnvironment = parseDotenvExample(
    await readRepositoryFile('apps/api/.env.example')
  )
  const testEnvironment = parseDotenvExample(
    await readRepositoryFile('apps/api/.env.test.example')
  )

  assert.equal(rootEnvironment.get('LOCAL_POSTGRES_PORT'), '55433')
  for (const secretName of secretNames) {
    assert.equal(rootEnvironment.get(secretName), '')
  }
  for (const secretName of removedSecretNames) {
    assert.equal(rootEnvironment.has(secretName), false)
  }
  assert.equal(rootEnvironment.has('AUTH_RUNTIME'), false)

  for (const field of ['DATABASE_URL', 'MIGRATION_DATABASE_URL']) {
    assert.equal(new URL(developmentEnvironment.get(field)).port, '55433')
    assert.equal(new URL(testEnvironment.get(field)).port, '55433')
  }

  assert.equal(
    new URL(testEnvironment.get('DB_INTEGRATION_DATABASE_URL')).port,
    '55432'
  )
  assert.equal(
    new URL(testEnvironment.get('API_INTEGRATION_DATABASE_URL')).port,
    '55432'
  )
  assert.equal(
    new URL(testEnvironment.get('DB_INTEGRATION_DATABASE_URL')).username,
    'nihongo'
  )
  assert.equal(
    new URL(testEnvironment.get('API_INTEGRATION_DATABASE_URL')).username,
    'nihongo'
  )
})

test('local database runbook documents both mutually exclusive local workflows', async () => {
  const readme = await readRepositoryFile(
    'operations/runbooks/local-database.v1.md'
  )
  const activation = await readRepositoryFile(
    'infra/postgres/init/local-database-activate.psql'
  )

  assert.match(readme, /--profile local-db up -d --wait postgres-local/u)
  assert.match(readme, /--profile local-db down -v/u)
  assert.match(readme, /NODE_ENV=test pnpm run db:migrate:deploy/u)
  assert.doesNotMatch(readme, /TEST_MIGRATIONS_PATH/u)
  assert.match(readme, /pnpm run db:seed:test/u)
  assert.match(
    readme,
    /psql -h 127\.0\.0\.1 -p "\$\{LOCAL_POSTGRES_PORT:-55433\}"/u
  )
  assert.match(
    readme,
    /--file=infra\/postgres\/init\/local-database-activate\.psql/u
  )
  assert.match(readme, /pnpm run test:api-regression/u)
  assert.match(readme, /wrapper login이 하나라도 이미 존재하면 안전하게 중단/u)
  assert.match(readme, /production provisioning의\s+대체물이 아닙니다/u)
  assert.match(readme, /--set=environment=TEST/u)
  assert.match(readme, /--set=environment=DEVELOPMENT/u)
  assert.match(readme, /activation 전에는 의도적으로 실패/u)
  assert.match(readme, /명시적 후속 승인 전에는 실행 금지/u)
  assert.match(activation, /BEGIN;/u)
  assert.match(activation, /INSERT INTO "DatabaseCapability"/u)
  assert.doesNotMatch(activation, /GRANT|_prisma_migrations/u)
  assert.doesNotMatch(activation, /phase/iu)
  assert.match(activation, /COMMIT;/u)
})

test('migration preflight admits exactly the test, development and production wrappers', async () => {
  for (const migrationPath of migrationPaths) {
    const migration = await readRepositoryFile(migrationPath)
    const preflight = migration.match(
      /expected_wrapper TEXT := CASE\n([\s\S]*?)\n\s+ELSE NULL END;/u
    )
    assert.ok(preflight, migrationPath)
    assert.deepEqual(
      preflight[1].split('\n').map((line) => line.trim()),
      [
        "WHEN pg_catalog.current_database() ~ '_test$' THEN 'nihongo_test_migration_login'",
        "WHEN pg_catalog.current_database() ~ '_dev$' THEN 'nihongo_development_migration_login'",
        "WHEN pg_catalog.current_database() = 'nihongo' THEN 'nihongo_production_migration_login'"
      ],
      migrationPath
    )
  }
})
