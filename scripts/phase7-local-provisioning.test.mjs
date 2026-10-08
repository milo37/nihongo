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
  'nihongo_phase7_owner',
  'nihongo_phase7_migration',
  'nihongo_app',
  'nihongo_auth_gateway',
  'nihongo_erasure_worker'
]

const wrapperRoles = [
  {
    name: 'nihongo_test_phase7_migration_login',
    grantedRole: 'nihongo_phase7_migration'
  },
  { name: 'nihongo_test_app_login', grantedRole: 'nihongo_app' },
  {
    name: 'nihongo_test_auth_gateway_login',
    grantedRole: 'nihongo_auth_gateway'
  },
  {
    name: 'nihongo_test_erasure_worker_login',
    grantedRole: 'nihongo_erasure_worker'
  },
  { name: 'nihongo_test_legacy_app_login', grantedRole: null },
  {
    name: 'nihongo_development_phase7_migration_login',
    grantedRole: 'nihongo_phase7_migration'
  },
  { name: 'nihongo_development_app_login', grantedRole: 'nihongo_app' },
  {
    name: 'nihongo_development_auth_gateway_login',
    grantedRole: 'nihongo_auth_gateway'
  },
  {
    name: 'nihongo_development_erasure_worker_login',
    grantedRole: 'nihongo_erasure_worker'
  },
  { name: 'nihongo_development_legacy_app_login', grantedRole: null }
]

const secretNames = [
  'PHASE7_TEST_MIGRATION_PASSWORD',
  'PHASE7_TEST_APP_PASSWORD',
  'PHASE7_TEST_AUTH_GATEWAY_PASSWORD',
  'PHASE7_TEST_ERASURE_WORKER_PASSWORD',
  'PHASE7_TEST_LEGACY_APP_PASSWORD',
  'PHASE7_DEVELOPMENT_MIGRATION_PASSWORD',
  'PHASE7_DEVELOPMENT_APP_PASSWORD',
  'PHASE7_DEVELOPMENT_AUTH_GATEWAY_PASSWORD',
  'PHASE7_DEVELOPMENT_ERASURE_WORKER_PASSWORD',
  'PHASE7_DEVELOPMENT_LEGACY_APP_PASSWORD'
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

  assert.match(compose, /postgres:\n[\s\S]*PHASE7_LOCAL_PROVISIONING: '0'/u)
  assert.match(
    compose,
    /postgres-phase7:\n[\s\S]*profiles: \['phase7-local'\][\s\S]*PHASE7_LOCAL_PROVISIONING: '1'/u
  )
  assert.match(compose, /127\.0\.0\.1:\$\{PHASE7_POSTGRES_PORT:-55433\}:5432/u)
  assert.match(compose, /nihongo-phase7-postgres-data:\/var\/lib\/postgresql/u)
  assert.match(compose, /\.phase7-local-provisioned/u)

  for (const secretName of secretNames) {
    const interpolation = '${' + secretName + ':-}'
    assert.ok(compose.includes(`${secretName}: ${interpolation}`))
  }
})

test('fresh init matches the canonical Phase 7 role graph', async () => {
  const init = await readRepositoryFile(
    'infra/postgres/init/02-provision-phase7-local.sh'
  )
  const enumMigration = await readRepositoryFile(
    'apps/api/prisma/migrations/20260827100000_phase7_admin_cms_enums/migration.sql'
  )
  const createdRoles = [...init.matchAll(/^CREATE ROLE "([^"]+)"/gmu)].map(
    (match) => match[1]
  )
  const expectedRoles = [...groupRoles, ...wrapperRoles.map(({ name }) => name)]

  assert.deepEqual(createdRoles.sort(), expectedRoles.sort())
  assert.match(init, /PHASE7_LOCAL_PROVISIONING:-0.*!= '1'/u)
  assert.match(init, /POSTGRES_DB must be the canonical nihongo_dev/u)
  assert.match(init, /bootstrap and wrapper secrets must all be distinct/u)
  assert.match(init, /\$phase7_role_attestation\$/u)
  assert.match(init, /exact_group_count <> 5/u)
  assert.match(init, /exact_wrapper_count <> 10/u)
  assert.match(init, /expected_membership_count <> 9/u)
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
    assert.match(enumMigration, new RegExp(`'${role}'`))
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
    assert.match(enumMigration, new RegExp(`'${name}'`))
  }

  const actualEdges = [
    ...init.matchAll(
      /^GRANT "([^"]+)" TO "([^"]+)"\n\s+WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;/gmu
    )
  ].map((match) => [match[1], match[2]])
  const expectedEdges = [
    ['nihongo_phase7_owner', 'nihongo_phase7_migration'],
    ...wrapperRoles.flatMap(({ grantedRole, name }) =>
      grantedRole ? [[grantedRole, name]] : []
    )
  ]

  assert.deepEqual(normalizeEdges(actualEdges), normalizeEdges(expectedEdges))
  assert.equal(actualEdges.length, 9)
})

test('fresh init owns and attests both canonical local databases', async () => {
  const init = await readRepositoryFile(
    'infra/postgres/init/02-provision-phase7-local.sh'
  )

  assert.match(init, /for phase7_database_name in nihongo_dev nihongo_test/u)
  assert.match(init, /CREATE EXTENSION pgcrypto WITH SCHEMA public;/u)
  assert.match(
    init,
    /ALTER SCHEMA public OWNER TO "nihongo_phase7_migration";/u
  )
  assert.match(
    init,
    /ALTER DATABASE :"target_database" OWNER TO "nihongo_phase7_migration";/u
  )
  assert.match(
    init,
    /REVOKE ALL PRIVILEGES ON DATABASE :"target_database" FROM PUBLIC;/u
  )
  assert.match(
    init,
    /GRANT CREATE, TEMPORARY ON DATABASE :"target_database"\s+TO "nihongo_phase7_migration";/u
  )
  assert.match(
    init,
    /GRANT CONNECT ON DATABASE :"target_database"\s+TO :"migration_login", :"app_login", :"auth_gateway_login",\s+:"erasure_worker_login", :"legacy_app_login";/u
  )
  assert.match(init, /\$phase7_local_attestation\$/u)
  assert.match(init, /unexpected_acl_count <> 0 OR missing_acl_count <> 0/u)
  assert.match(init, /touch "\$PGDATA\/\.phase7-local-provisioned"/u)
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

  assert.equal(rootEnvironment.get('PHASE7_POSTGRES_PORT'), '55433')
  for (const secretName of secretNames) {
    assert.equal(rootEnvironment.get(secretName), '')
  }

  for (const field of [
    'DATABASE_URL',
    'PHASE7_MIGRATION_DATABASE_URL',
    'AUTH_GATEWAY_DATABASE_URL'
  ]) {
    assert.equal(new URL(developmentEnvironment.get(field)).port, '55433')
    assert.equal(new URL(testEnvironment.get(field)).port, '55433')
  }

  assert.equal(
    new URL(testEnvironment.get('PHASE7_INTEGRATION_DATABASE_URL')).port,
    '55432'
  )
  assert.equal(
    new URL(testEnvironment.get('PHASE7_API_INTEGRATION_DATABASE_URL')).port,
    '55432'
  )
  assert.equal(
    new URL(testEnvironment.get('PHASE7_INTEGRATION_DATABASE_URL')).username,
    'nihongo'
  )
  assert.equal(
    new URL(testEnvironment.get('PHASE7_API_INTEGRATION_DATABASE_URL'))
      .username,
    'nihongo'
  )
})

test('README documents both mutually exclusive local workflows', async () => {
  const readme = await readRepositoryFile('README.md')
  const activation = await readRepositoryFile(
    'infra/postgres/init/phase7-local-activate.psql'
  )

  assert.match(readme, /--profile phase7-local up -d --wait postgres-phase7/u)
  assert.match(readme, /NODE_ENV=test pnpm run db:migrate:phase7/u)
  assert.match(readme, /ADMIN_CMS_MODE=technical pnpm run db:seed:test/u)
  assert.match(readme, /ADMIN_CMS_MODE=technical pnpm run db:seed:dev/u)
  assert.match(readme, /pnpm run test:phase7:db/u)
  assert.match(readme, /pnpm run test:phase7:api/u)
  assert.match(readme, /wrapper login이 하나라도 이미 존재하면 안전하게 중단/u)
  assert.match(readme, /production provisioning의\s+대체물이 아닙니다/u)
  assert.match(readme, /phase7_environment=TEST/u)
  assert.match(readme, /phase7_environment=DEVELOPMENT/u)
  assert.match(readme, /activation 전에는 의도적으로 실패/u)
  assert.match(readme, /명시적 후속 승인 전에는 실행 금지/u)
  assert.match(activation, /BEGIN;/u)
  assert.match(activation, /"phase7_register_database_capability"/u)
  assert.match(activation, /"phase7_activate_v1_issuer"/u)
  assert.match(activation, /COMMIT;/u)
})
