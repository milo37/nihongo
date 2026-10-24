import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isWebRuntimeSourcePath,
  reconcileSecretAllowlist,
  scanTrackedSecretText,
  scanUnsafeHtmlSource,
  validateSecretAllowlist
} from './tracked-source-security.mjs'

test('runtime path matcher includes mocks but excludes tests and specs', () => {
  assert.equal(isWebRuntimeSourcePath('apps/web/src/app/page.tsx'), true)
  assert.equal(
    isWebRuntimeSourcePath('apps/web/src/mocks/handlers/example.ts'),
    true
  )
  assert.equal(isWebRuntimeSourcePath('apps/web/src/app/page.test.tsx'), false)
  assert.equal(isWebRuntimeSourcePath('apps/web/src/test/setup.ts'), false)
})

test('plain React text, comments and string literals do not trigger HTML sink rules', () => {
  const sourceText = `
    // node.innerHTML = value
    const marker = 'dangerouslySetInnerHTML'
    export const View = ({ value }: { value: string }) => <p>{value}</p>
  `
  assert.deepEqual(
    scanUnsafeHtmlSource({
      filePath: 'apps/web/src/app/plain.tsx',
      sourceText
    }),
    []
  )
})

test('TypeScript AST gate detects every prohibited HTML execution surface', () => {
  const sourceText = `
    const view = <iframe dangerouslySetInnerHTML={{ __html: value }} srcDoc={value} />
    const properties = { dangerouslySetInnerHTML: value, srcDoc: value }
    node.innerHTML = value
    node['outerHTML'] = value
    node.insertAdjacentHTML('beforeend', value)
    new DOMParser()
    range.createContextualFragment(value)
    document.write(value)
    document.writeln(value)
    eval(value)
    new Function(value)
    node.setAttribute('onerror', value)
  `
  const rules = new Set(
    scanUnsafeHtmlSource({
      filePath: 'apps/web/src/app/unsafe.tsx',
      sourceText
    }).map(({ ruleId }) => ruleId)
  )
  assert.deepEqual(
    rules,
    new Set([
      'JSX_DANGEROUSLY_SET_INNER_HTML',
      'OBJECT_DANGEROUSLY_SET_INNER_HTML',
      'DOM_INNER_HTML',
      'DOM_OUTER_HTML',
      'DOM_INSERT_ADJACENT_HTML',
      'DOM_SRC_DOC',
      'DOM_PARSER',
      'DOM_CONTEXTUAL_FRAGMENT',
      'DOCUMENT_WRITE',
      'DYNAMIC_EVAL',
      'DYNAMIC_FUNCTION',
      'EVENT_HANDLER_ATTRIBUTE'
    ])
  )
})

test('secret scan detects provider, PEM and sensitive high-entropy values without returning raw values', () => {
  const provider = ['ghp_', 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'].join('')
  const pem = ['-----BEGIN ', 'PRIVATE KEY-----'].join('')
  const generic = '8YzP2mQa7VnR4kTx9LcW6uJh3DfB5sGe'
  const text = `${provider}\n${pem}\npassword: "${generic}"`
  const findings = scanTrackedSecretText({
    filePath: 'config/example.txt',
    text
  })

  assert.deepEqual(
    new Set(findings.map(({ ruleId }) => ruleId)),
    new Set([
      'GITHUB_TOKEN',
      'PRIVATE_KEY_PEM',
      'GENERIC_HIGH_ENTROPY_CREDENTIAL'
    ])
  )
  const serialized = JSON.stringify(findings)
  assert.equal(serialized.includes(provider), false)
  assert.equal(serialized.includes(generic), false)
})

test('generic credential rule ignores placeholders and non-sensitive random values', () => {
  const text = [
    'password: "replace_with_test_password_that_is_long"',
    'identifier: "8YzP2mQa7VnR4kTx9LcW6uJh3DfB5sGe"'
  ].join('\n')
  assert.deepEqual(scanTrackedSecretText({ filePath: 'example.env', text }), [])
})

test('generic credential rule detects unquoted dotenv and YAML assignments', () => {
  const dotenvCredential = '8YzP2mQa7VnR4kTx9LcW6uJh3DfB5sGe'
  const yamlCredential = '4QwE7rTy9Ui2OpAs5DfGh8JkL3ZxCvBn'
  const text = [
    `PASSWORD=${dotenvCredential}`,
    `client_secret: ${yamlCredential} # deployment credential`
  ].join('\n')
  const findings = scanTrackedSecretText({
    filePath: 'config/runtime.env',
    text
  })

  assert.equal(findings.length, 2)
  assert.deepEqual(
    findings.map(({ ruleId }) => ruleId),
    ['GENERIC_HIGH_ENTROPY_CREDENTIAL', 'GENERIC_HIGH_ENTROPY_CREDENTIAL']
  )
  const serialized = JSON.stringify(findings)
  assert.equal(serialized.includes(dotenvCredential), false)
  assert.equal(serialized.includes(yamlCredential), false)
})

test('secret scan detects credential URI passwords in dotenv and YAML without returning raw values', () => {
  const dotenvCredential = '8YzP2mQa7VnR4kTx9LcW6uJh3DfB5sGe'
  const yamlCredential = '4QwE7rTy9Ui2OpAs5DfGh8JkL3ZxCvBn'
  const text = [
    `DATABASE_URL=postgresql://app:${dotenvCredential}@db.example.test/app`,
    `database_url: mongodb://app:${yamlCredential}@db.example.test/app`
  ].join('\n')
  const findings = scanTrackedSecretText({
    filePath: 'config/runtime.env',
    text
  })

  assert.equal(findings.length, 2)
  assert.deepEqual(
    findings.map(({ ruleId }) => ruleId),
    ['CREDENTIAL_URI_PASSWORD', 'CREDENTIAL_URI_PASSWORD']
  )
  const serialized = JSON.stringify(findings)
  assert.equal(serialized.includes(dotenvCredential), false)
  assert.equal(serialized.includes(yamlCredential), false)
})

test('secret allowlist requires exact, unexpired, allowlistable identities', () => {
  const text = [
    'password: "',
    '8YzP2mQa7VnR4kTx',
    '9LcW6uJh3DfB5sGe',
    '"'
  ].join('')
  const [finding] = scanTrackedSecretText({
    filePath: 'fixtures/synthetic.txt',
    text
  })
  assert.ok(finding)
  const document = {
    schemaVersion: 1,
    entries: [
      {
        path: finding.path,
        line: finding.line,
        ruleId: finding.ruleId,
        fingerprint: finding.fingerprint,
        classification: 'SYNTHETIC_TEST_FIXTURE',
        expiresOn: '2026-10-15'
      }
    ]
  }
  const allowlist = validateSecretAllowlist({
    document,
    now: new Date('2026-09-29T00:00:00.000Z')
  })
  assert.deepEqual(
    reconcileSecretAllowlist({ allowlist, findings: [finding] }),
    {
      activeFindings: [],
      suppressedFindings: [finding],
      unusedEntries: []
    }
  )

  assert.throws(() =>
    validateSecretAllowlist({
      document: {
        ...document,
        entries: [{ ...document.entries[0], path: 'fixtures/*' }]
      },
      now: new Date('2026-09-29T00:00:00.000Z')
    })
  )
  assert.throws(() =>
    validateSecretAllowlist({
      document: {
        ...document,
        entries: [{ ...document.entries[0], ruleId: 'GITHUB_TOKEN' }]
      },
      now: new Date('2026-09-29T00:00:00.000Z')
    })
  )
})
