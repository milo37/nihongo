import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ESLint } from 'eslint'

// Each sample is one pattern the removed tracked-source-security.mjs blocked.
const SAMPLES = {
  JSX_DANGEROUSLY_SET_INNER_HTML:
    'export const A = () => <div dangerouslySetInnerHTML={{ __html: "x" }} />',
  OBJECT_DANGEROUSLY_SET_INNER_HTML:
    'export const props = { dangerouslySetInnerHTML: { __html: "x" } }',
  DOM_SRC_DOC: 'export const A = () => <iframe srcDoc="x" />',
  DOM_INNER_HTML: 'document.body.innerHTML = "x"',
  DOM_INNER_HTML_COMPUTED: 'document.body["innerHTML"] = "x"',
  DOM_OUTER_HTML: 'document.body.outerHTML = "x"',
  DYNAMIC_EVAL: 'eval("1")',
  DYNAMIC_FUNCTION_CALL: 'Function("return 1")',
  DYNAMIC_FUNCTION_NEW: 'new Function("return 1")',
  IMPLIED_EVAL: 'setTimeout("alert(1)", 1)',
  DOM_INSERT_ADJACENT_HTML:
    'document.body.insertAdjacentHTML("beforeend", "x")',
  DOM_CONTEXTUAL_FRAGMENT: 'new Range().createContextualFragment("x")',
  DOCUMENT_WRITE: 'document.write("x")',
  DOCUMENT_WRITELN: 'document.writeln("x")',
  EVENT_HANDLER_ATTRIBUTE: 'document.body.setAttribute("onclick", "x")',
  DOM_PARSER: 'new DOMParser()'
}

const SECURITY_RULES = new Set([
  'no-eval',
  'no-implied-eval',
  'no-new-func',
  'react/no-danger',
  'no-restricted-syntax'
])

const lint = async (code, filePath) => {
  const [result] = await new ESLint().lintText(code, { filePath })
  return result.messages.filter((message) => message.severity === 2)
}

for (const [ruleId, code] of Object.entries(SAMPLES)) {
  test(`browser runtime source rejects ${ruleId}`, async () => {
    for (const app of ['web', 'admin']) {
      const errors = await lint(code, `apps/${app}/src/sample.tsx`)
      assert.ok(
        errors.some((error) => SECURITY_RULES.has(error.ruleId)),
        `${app}: ${ruleId} was not reported`
      )
    }
  })
}

test('test files and safe DOM writes are not reported', async () => {
  assert.deepEqual(
    await lint(SAMPLES.DOM_INNER_HTML, 'apps/web/src/sample.test.tsx'),
    []
  )
  assert.deepEqual(
    await lint(
      'document.body.textContent = "x"\ndocument.body.setAttribute("title", "x")',
      'apps/web/src/sample.ts'
    ),
    []
  )
})
