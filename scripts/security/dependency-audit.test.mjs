import assert from 'node:assert/strict'
import test from 'node:test'

import { DEV_AUDIT_EXCEPTIONS, evaluateAudit } from './dependency-audit.mjs'

const report = (...advisories) => ({
  advisories: Object.fromEntries(
    advisories.map((advisory, index) => [String(index), advisory])
  )
})
const picomatch = {
  github_advisory_id: 'GHSA-fc5q-39xc-vjpf',
  module_name: 'picomatch',
  severity: 'high'
}
const exceptions = [
  { ghsa: 'GHSA-fc5q-39xc-vjpf', module: 'picomatch', expires: '2026-12-18' }
]

test('an exception allows its advisory before the expiry date', () => {
  const result = evaluateAudit(report(picomatch), {
    now: new Date('2026-12-17T23:59:59Z'),
    exceptions
  })
  assert.deepEqual(result, { blocking: [], excepted: ['GHSA-fc5q-39xc-vjpf'] })
})

test('an exception stops applying on its expiry date', () => {
  const result = evaluateAudit(report(picomatch), {
    now: new Date('2026-12-18T00:00:00Z'),
    exceptions
  })
  assert.deepEqual(result.excepted, [])
  assert.deepEqual(result.blocking, [
    {
      ghsa: 'GHSA-fc5q-39xc-vjpf',
      module: 'picomatch',
      severity: 'high',
      expiredException: '2026-12-18'
    }
  ])
})

test('other high and critical advisories still block', () => {
  const result = evaluateAudit(
    report(
      picomatch,
      {
        github_advisory_id: 'GHSA-aaaa-bbbb-cccc',
        module_name: 'x',
        severity: 'critical'
      },
      {
        github_advisory_id: 'GHSA-fc5q-39xc-vjpf',
        module_name: 'other',
        severity: 'high'
      },
      {
        github_advisory_id: 'GHSA-dddd-eeee-ffff',
        module_name: 'y',
        severity: 'moderate'
      }
    ),
    { now: new Date('2026-11-18T00:00:00Z'), exceptions }
  )
  assert.deepEqual(
    result.blocking.map((item) => `${item.ghsa} ${item.module}`),
    ['GHSA-aaaa-bbbb-cccc x', 'GHSA-fc5q-39xc-vjpf other']
  )
})

test('an unreadable report fails closed', () => {
  assert.throws(
    () => evaluateAudit({ error: 'offline' }, { now: new Date(), exceptions }),
    /DEPENDENCY_AUDIT_REPORT_UNREADABLE/u
  )
})

test('every development exception names a module, a date and a reason', () => {
  for (const exception of DEV_AUDIT_EXCEPTIONS) {
    assert.match(exception.ghsa, /^GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/u)
    assert.ok(exception.module)
    assert.match(exception.expires, /^\d{4}-\d{2}-\d{2}$/u)
    assert.ok(exception.reason)
  }
})
