import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

// #679: infra/aws/files/provision-db.sh (PRODUCTION) says it builds the same
// role graph as infra/postgres/init/02-provision-local-database.sh (TEST and
// DEVELOPMENT) with other login names. The SQL differs in form (repair vs
// fresh bootstrap), so this compares the facts both encode.
const read = (path) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')

const sqlBlocks = (script) =>
  Object.fromEntries(
    [...script.matchAll(/<<'(\w+_SQL)'\n([\s\S]*?)\n\1\n/gu)].map(
      ([, name, body]) => [name, body]
    )
  )

const WRAPPER =
  /nihongo_(production|test|development)_(migration|app|guest_cleanup_worker)_login/gu
const normalize = (text) =>
  text.replace(WRAPPER, 'nihongo_ENV_$2_login').replace(/\s+/gu, ' ').trim()
const environments = (text) =>
  [
    ...new Set(
      [...text.matchAll(WRAPPER)].map(([, environment]) => environment)
    )
  ].sort()

const production = sqlBlocks(read('infra/aws/files/provision-db.sh'))
const local = sqlBlocks(
  read('infra/postgres/init/02-provision-local-database.sh')
)

const memberships = (sql) =>
  new Set(
    [...sql.matchAll(/GRANT "(\w+)" TO "(\w+)"\s+WITH ([^;]+);/gu)].map(
      ([, granted, member, options]) =>
        normalize(`${granted} -> ${member} | ${options}`)
    )
  )
const expectedMemberships = (sql) =>
  new Set(
    [
      ...sql
        .match(/INSERT INTO expected_membership VALUES([\s\S]*?);/u)[1]
        .matchAll(/\('(\w+)', '(\w+)'\)/gu)
    ].map(([, member, granted]) => normalize(`${granted} -> ${member}`))
  )
const attestedCount = (sql, name) =>
  Number(sql.match(new RegExp(`${name} <> (\\d+)`, 'u'))[1])

test('both scripts provision the expected environments', () => {
  assert.deepEqual(environments(production.ROLES_SQL), ['production'])
  assert.deepEqual(environments(local.ROLES_SQL), ['development', 'test'])
})

test('group and login roles carry the same attributes', () => {
  const groupAttributes = (sql) =>
    new Set(
      [
        ...sql.matchAll(
          /CREATE ROLE (?:%I|"nihongo_(?:owner|migration|app|guest_cleanup_worker)")\s+(NOLOGIN[^;'\n]*(?:\n\s+[A-Z ]+)?)/gu
        )
      ].map(([, attributes]) => normalize(attributes).replace(/;$/u, ''))
    )
  const loginAttributes = (sql) =>
    new Set(
      [
        ...sql.matchAll(
          /CREATE ROLE (?:%I|"\w+_login")\s+(LOGIN[A-Z \n]*?)(?= PASSWORD|'|;)/gu
        )
      ].map(([, attributes]) => normalize(attributes))
    )
  assert.deepEqual(
    groupAttributes(production.ROLES_SQL),
    groupAttributes(local.ROLES_SQL)
  )
  assert.deepEqual(
    loginAttributes(production.ROLES_SQL),
    loginAttributes(local.ROLES_SQL)
  )
  assert.equal(groupAttributes(local.ROLES_SQL).size, 1)
  assert.equal(loginAttributes(local.ROLES_SQL).size, 1)
})

test('role memberships and their attestation match', () => {
  for (const sql of [production.ROLES_SQL, local.ROLES_SQL]) {
    const granted = memberships(sql)
    assert.equal(granted.size, 4)
    assert.deepEqual(
      new Set([...granted].map((line) => line.replace(/ \| .*$/u, ''))),
      expectedMemberships(sql)
    )
  }
  assert.deepEqual(
    memberships(production.ROLES_SQL),
    memberships(local.ROLES_SQL)
  )
  for (const [sql, environmentCount] of [
    [production.ROLES_SQL, 1],
    [local.ROLES_SQL, 2]
  ]) {
    assert.equal(attestedCount(sql, 'exact_group_count'), 4)
    assert.equal(
      attestedCount(sql, 'exact_wrapper_count'),
      3 * environmentCount
    )
    assert.equal(
      attestedCount(sql, 'expected_membership_count'),
      1 + 3 * environmentCount
    )
    assert.equal(attestedCount(sql, 'unexpected_membership_count'), 0)
  }
})

test('database privileges match', () => {
  const statements = (sql) =>
    new Set(
      normalize(sql)
        .replace(/:"target_database"|"nihongo"(?= )/gu, 'DB')
        .replace(/:"bootstrap_user"|"postgres"/gu, 'BOOTSTRAP')
        .replace(/:"(migration|app|guest_cleanup)_login"/gu, (_, kind) =>
          kind === 'guest_cleanup'
            ? '"nihongo_ENV_guest_cleanup_worker_login"'
            : `"nihongo_ENV_${kind}_login"`
        )
        .split(';')
        .map((statement) => statement.trim())
        .filter(Boolean)
    )
  assert.deepEqual(
    statements(production.DATABASE_SQL),
    statements(local.DATABASE_SQL)
  )
})
