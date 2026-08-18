import fs from 'node:fs'
import { builtinModules } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const defaultRootDir = path.resolve(scriptDirectory, '../..')
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.mjs', '.js'])
const SKIPPED_DIRECTORIES = new Set([
  'coverage',
  'dist',
  'generated',
  'node_modules'
])
const FRAMEWORK_IMPORT_PREFIXES = ['@better-auth/', '@hono/', '@prisma/']
const FRAMEWORK_PACKAGE_ROOTS = new Set([
  '@neondatabase/serverless',
  'axios',
  'better-auth',
  'dotenv',
  'drizzle-orm',
  'env-var',
  'hono',
  'knex',
  'mongoose',
  'msw',
  'pg',
  'postgres',
  'prisma',
  'react',
  'react-dom',
  'sequelize',
  'typeorm'
])
const HTTP_ROUTE_METHODS = new Set([
  'delete',
  'get',
  'options',
  'patch',
  'post',
  'put'
])
const SENSITIVE_CONTRACT_PATTERN =
  /^@nihongo\/contracts\/(?:admin(?:-|\/)|dashboard(?:-|\/)|.*(?:result|reviewed|submit|wrong-note))/
const PUBLIC_WEB_PATH_PATTERN =
  /^apps\/web\/src\/(?:api\/question\/|app\/(?:home|practice\/session)\/)/
const OWNER_PRACTICE_SESSION_PATH_PATTERN =
  /^apps\/web\/src\/app\/practice\/session\//
const TEST_SOURCE_PATH_PATTERN = /\.(?:test|spec)\.[cm]?[jt]sx?$/
const WEB_ALIAS_ROOTS = new Map([
  ['@/', ''],
  ['@api/', 'api/'],
  ['@app/', 'app/'],
  ['@common/', 'common/'],
  ['@provider/', 'provider/'],
  ['@store/', 'store/'],
  ['@libs/', 'libs/'],
  ['@mocks/', 'mocks/'],
  ['@util/', 'util/'],
  ['@assets/', 'assets/']
])
const NODE_BUILTIN_IMPORTS = new Set([
  ...builtinModules,
  ...builtinModules.map((moduleName) => `node:${moduleName}`)
])

const normalizePath = (value) => value.split(path.sep).join('/')

const walkFiles = (directory) => {
  if (!fs.existsSync(directory)) return []

  const files = []

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIPPED_DIRECTORIES.has(entry.name)) continue

    const entryPath = path.join(directory, entry.name)

    if (entry.isDirectory()) {
      files.push(...walkFiles(entryPath))
      continue
    }

    if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(entryPath)
    }
  }

  return files
}

const classifyWorkspace = (rootDir, fileName) => {
  const relative = normalizePath(path.relative(rootDir, fileName))
  const match = /^(apps|packages)\/([^/]+)\//.exec(relative)

  if (!match) return null

  return {
    kind: match[1].slice(0, -1),
    name: match[2],
    id: `${match[1]}/${match[2]}`
  }
}

const hasRuntimeBindings = (node) => {
  if (!node.importClause) return true
  if (node.importClause.isTypeOnly) return false

  const bindings = node.importClause.namedBindings

  if (!bindings || ts.isNamespaceImport(bindings)) return true

  return bindings.elements.some((element) => !element.isTypeOnly)
}

const collectModuleReferences = (sourceFile) => {
  const references = []

  const addReference = (
    node,
    specifier,
    runtime,
    dynamic = false,
    deferred = false
  ) => {
    references.push({ deferred, dynamic, node, specifier, runtime })
  }

  const isExactDeferredStudySubmitImport = (node, specifier) => {
    const deferredSubmitOwners = new Map([
      [
        '@app/practice/commands/submitStudySessionCommand',
        '/apps/web/src/app/practice/hooks/useSubmitStudySession.ts'
      ],
      [
        '@app/practice/commands/submitStudySessionV2Command',
        '/apps/web/src/app/practice/hooks/useSubmitStudySessionV2.ts'
      ]
    ])
    const expectedOwner = deferredSubmitOwners.get(specifier)

    if (
      expectedOwner === undefined ||
      !normalizePath(sourceFile.fileName).endsWith(expectedOwner)
    ) {
      return false
    }

    let current = node.parent
    while (current) {
      if (ts.isFunctionLike(current)) {
        const parent = current.parent
        return Boolean(
          parent &&
            ts.isPropertyAssignment(parent) &&
            parent.initializer === current &&
            ((ts.isIdentifier(parent.name) &&
              parent.name.text === 'mutationFn') ||
              (ts.isStringLiteralLike(parent.name) &&
                parent.name.text === 'mutationFn'))
        )
      }
      current = current.parent
    }
    return false
  }

  const visit = (node) => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      addReference(
        node.moduleSpecifier,
        node.moduleSpecifier.text,
        hasRuntimeBindings(node)
      )
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      const allNamedExportsAreTypes =
        node.exportClause &&
        ts.isNamedExports(node.exportClause) &&
        node.exportClause.elements.every((element) => element.isTypeOnly)

      addReference(
        node.moduleSpecifier,
        node.moduleSpecifier.text,
        !node.isTypeOnly && !allNamedExportsAreTypes
      )
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      addReference(
        node.arguments[0],
        node.arguments[0].text,
        true,
        true,
        isExactDeferredStudySubmitImport(node, node.arguments[0].text)
      )
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return references
}

const workspaceFromSpecifier = (rootDir, importerFile, specifier) => {
  const packageMatch = /^@nihongo\/(web|api|contracts|domain)(?:\/|$)/.exec(
    specifier
  )

  if (packageMatch) {
    const name = packageMatch[1]
    return {
      kind: name === 'web' || name === 'api' ? 'app' : 'package',
      name,
      id: `${name === 'web' || name === 'api' ? 'apps' : 'packages'}/${name}`
    }
  }

  if (!specifier.startsWith('.')) return null

  return classifyWorkspace(
    rootDir,
    path.resolve(path.dirname(importerFile), specifier)
  )
}

const isForbiddenPurePackageImport = (specifier) => {
  if (NODE_BUILTIN_IMPORTS.has(specifier)) return true
  if (
    FRAMEWORK_IMPORT_PREFIXES.some((prefix) => specifier.startsWith(prefix))
  ) {
    return true
  }

  const packageRoot = specifier.startsWith('@')
    ? specifier.split('/').slice(0, 2).join('/')
    : specifier.split('/')[0]

  return FRAMEWORK_PACKAGE_ROOTS.has(packageRoot)
}

const createDiagnostic = (rootDir, sourceFile, node, code, message) => {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart())

  return {
    code,
    file: normalizePath(path.relative(rootDir, sourceFile.fileName)),
    line: position.line + 1,
    column: position.character + 1,
    message
  }
}

const createFileDiagnostic = (rootDir, fileName, code, message, line = 1) => ({
  code,
  file: normalizePath(path.relative(rootDir, fileName)),
  line,
  column: 1,
  message
})

const getWorkspaceManifests = (rootDir) => {
  const manifests = []

  for (const collection of ['apps', 'packages']) {
    const collectionPath = path.join(rootDir, collection)
    if (!fs.existsSync(collectionPath)) continue

    for (const entry of fs.readdirSync(collectionPath, {
      withFileTypes: true
    })) {
      if (!entry.isDirectory()) continue

      const fileName = path.join(collectionPath, entry.name, 'package.json')
      if (!fs.existsSync(fileName)) continue

      const manifest = JSON.parse(fs.readFileSync(fileName, 'utf8'))
      manifests.push({
        fileName,
        manifest,
        workspace: {
          kind: collection === 'apps' ? 'app' : 'package',
          name: entry.name,
          id: `${collection}/${entry.name}`
        }
      })
    }
  }

  return manifests
}

const findManifestLine = (fileName, dependencyName) => {
  const lines = fs.readFileSync(fileName, 'utf8').split(/\r?\n/)
  const index = lines.findIndex((line) => line.includes(`"${dependencyName}"`))
  return index >= 0 ? index + 1 : 1
}

const checkManifestArchitecture = (rootDir) => {
  const diagnostics = []
  const manifests = getWorkspaceManifests(rootDir)
  const byPackageName = new Map(
    manifests.map((entry) => [entry.manifest.name, entry])
  )
  const runtimeGraph = new Map()
  const graphSource = new Map()

  for (const entry of manifests) {
    const dependencies = {
      ...(entry.manifest.dependencies ?? {}),
      ...(entry.manifest.optionalDependencies ?? {})
    }
    runtimeGraph.set(entry.workspace.id, new Set())

    for (const dependencyName of Object.keys(dependencies)) {
      const target = byPackageName.get(dependencyName)
      const line = findManifestLine(entry.fileName, dependencyName)

      if (
        entry.workspace.kind === 'package' &&
        target?.workspace.kind === 'app'
      ) {
        diagnostics.push(
          createFileDiagnostic(
            rootDir,
            entry.fileName,
            'ARCH108',
            'package manifests cannot depend on apps',
            line
          )
        )
      }

      if (
        entry.workspace.id === 'apps/web' &&
        target?.workspace.id === 'packages/domain'
      ) {
        diagnostics.push(
          createFileDiagnostic(
            rootDir,
            entry.fileName,
            'ARCH109',
            'apps/web manifest cannot depend on packages/domain',
            line
          )
        )
      }

      if (
        (entry.workspace.id === 'packages/contracts' ||
          entry.workspace.id === 'packages/domain') &&
        isForbiddenPurePackageImport(dependencyName)
      ) {
        diagnostics.push(
          createFileDiagnostic(
            rootDir,
            entry.fileName,
            'ARCH110',
            'pure package manifests cannot depend on frameworks, persistence, environment, or Node I/O libraries',
            line
          )
        )
      }

      if (target && target.workspace.id !== entry.workspace.id) {
        runtimeGraph.get(entry.workspace.id).add(target.workspace.id)
        graphSource.set(`${entry.workspace.id}->${target.workspace.id}`, {
          fileName: entry.fileName,
          line
        })
      }
    }
  }

  for (const cycle of collectPackageCycles(runtimeGraph)) {
    const [from, to] = cycle
    const source = graphSource.get(`${from}->${to}`)
    if (!source) continue

    diagnostics.push(
      createFileDiagnostic(
        rootDir,
        source.fileName,
        'ARCH111',
        `workspace manifest cycle detected: ${cycle.join(' -> ')}`,
        source.line
      )
    )
  }

  return diagnostics
}

const RESPONSE_SCHEMA_NAME_PATTERN = /responseSchema$/i
const REQUEST_SCHEMA_NAME_PATTERN =
  /(?:params?|query|body|headers?|request)Schema$/i
const REQUESTLESS_API_ROUTES = new Set(['delete:/guest-principal', 'get:/me'])
const NO_CONTENT_API_ROUTE_SOURCES = new Set([
  'apps/api/src/routes/principal.ts#delete:/guest-principal',
  'apps/api/src/routes/studyDrafts.ts#post:/:sessionId/cancellation'
])

const unwrapExpression = (node) => {
  let current = node

  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isAwaitExpression(current)
  ) {
    current = current.expression
  }

  return current
}

const getSchemaReferenceFromParseCall = (node) => {
  const expression = unwrapExpression(node)

  if (
    !ts.isCallExpression(expression) ||
    !ts.isPropertyAccessExpression(expression.expression) ||
    expression.expression.name.text !== 'parse'
  ) {
    return null
  }

  const schema = unwrapExpression(expression.expression.expression)
  if (ts.isIdentifier(schema)) {
    return { name: schema.text, namespace: null }
  }
  if (
    ts.isPropertyAccessExpression(schema) &&
    ts.isIdentifier(schema.expression)
  ) {
    return { name: schema.name.text, namespace: schema.expression.text }
  }
  return null
}

const collectContractSchemaBindings = (sourceFile, namePattern) => {
  const names = new Set()
  const namespaces = new Set()

  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteralLike(statement.moduleSpecifier) ||
      !statement.moduleSpecifier.text.startsWith('@nihongo/contracts/') ||
      !statement.importClause ||
      statement.importClause.isTypeOnly
    ) {
      continue
    }

    const bindings = statement.importClause.namedBindings
    if (bindings && ts.isNamespaceImport(bindings)) {
      namespaces.add(bindings.name.text)
      continue
    }
    if (!bindings || !ts.isNamedImports(bindings)) continue

    for (const binding of bindings.elements) {
      if (binding.isTypeOnly) continue
      const importedName = binding.propertyName?.text ?? binding.name.text
      if (namePattern.test(importedName)) names.add(binding.name.text)
    }
  }

  return { names, namespaces }
}

const isAllowedSchemaParseExpression = (
  node,
  { allowLocalName = false, namePattern, names, namespaces }
) => {
  const schema = getSchemaReferenceFromParseCall(node)
  if (!schema) return false

  if (schema.namespace !== null) {
    return namespaces.has(schema.namespace) && namePattern.test(schema.name)
  }

  return (
    names.has(schema.name) || (allowLocalName && namePattern.test(schema.name))
  )
}

const getHandlerContextNames = (handler) => {
  if (
    !ts.isArrowFunction(handler) &&
    !ts.isFunctionExpression(handler) &&
    !ts.isFunctionDeclaration(handler)
  ) {
    return new Set()
  }

  const contextParameter = handler.parameters[0]
  return contextParameter && ts.isIdentifier(contextParameter.name)
    ? new Set([contextParameter.name.text])
    : new Set()
}

const isContextPropertyAccess = (node, contextNames, propertyName) =>
  ts.isPropertyAccessExpression(node) &&
  ts.isIdentifier(node.expression) &&
  contextNames.has(node.expression.text) &&
  node.name.text === propertyName

const containsContextRequestAccess = (node, contextNames) => {
  let found = false
  const visit = (current) => {
    if (isContextPropertyAccess(current, contextNames, 'req')) {
      found = true
      return
    }
    ts.forEachChild(current, visit)
  }
  visit(node)
  return found
}

const expressionReferencesBinding = (node, bindings) => {
  let found = false
  const visit = (current) => {
    if (ts.isIdentifier(current) && bindings.has(current.text)) {
      found = true
      return
    }
    ts.forEachChild(current, visit)
  }
  visit(node)
  return found
}

const collectRequestValueBindings = (handler, contextNames) => {
  const bindings = new Set()
  let changed = true

  while (changed) {
    changed = false
    const visit = (node) => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer &&
        (containsContextRequestAccess(node.initializer, contextNames) ||
          expressionReferencesBinding(node.initializer, bindings)) &&
        !bindings.has(node.name.text)
      ) {
        bindings.add(node.name.text)
        changed = true
      }
      ts.forEachChild(node, visit)
    }
    visit(handler)
  }

  return bindings
}

const containsRequestSchemaParse = (
  handler,
  contextNames,
  requestSchemaBindings
) => {
  const requestBindings = collectRequestValueBindings(handler, contextNames)
  let found = false
  const visit = (node) => {
    if (
      isAllowedSchemaParseExpression(node, requestSchemaBindings) &&
      ts.isCallExpression(unwrapExpression(node))
    ) {
      const [input] = unwrapExpression(node).arguments
      if (
        input &&
        (containsContextRequestAccess(input, contextNames) ||
          expressionReferencesBinding(input, requestBindings))
      ) {
        found = true
        return
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(handler)
  return found
}

const collectValidatedResponseBindings = (handler, responseSchemaBindings) => {
  const bindings = new Set()
  let changed = true

  while (changed) {
    changed = false
    const visit = (node) => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer &&
        (isAllowedSchemaParseExpression(
          node.initializer,
          responseSchemaBindings
        ) ||
          (ts.isIdentifier(unwrapExpression(node.initializer)) &&
            bindings.has(unwrapExpression(node.initializer).text))) &&
        !bindings.has(node.name.text)
      ) {
        bindings.add(node.name.text)
        changed = true
      }
      ts.forEachChild(node, visit)
    }
    visit(handler)
  }

  return bindings
}

const collectContextJsonCalls = (handler, contextNames) => {
  const calls = []
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      isContextPropertyAccess(node.expression, contextNames, 'json')
    ) {
      calls.push(node)
    }
    ts.forEachChild(node, visit)
  }
  visit(handler)
  return calls
}

const containsNoContentResponse = (handler, contextNames) => {
  let found = false
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      isContextPropertyAccess(node.expression, contextNames, 'body') &&
      node.arguments[0]?.kind === ts.SyntaxKind.NullKeyword &&
      ts.isNumericLiteral(node.arguments[1]) &&
      node.arguments[1].text === '204'
    ) {
      found = true
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(handler)
  return found
}

const isValidatedResponseExpression = (
  node,
  validatedBindings,
  responseSchemaBindings
) => {
  const expression = unwrapExpression(node)
  return (
    isAllowedSchemaParseExpression(expression, responseSchemaBindings) ||
    (ts.isIdentifier(expression) && validatedBindings.has(expression.text))
  )
}

const isHttpRouteRegistration = (node) => {
  if (
    !ts.isCallExpression(node) ||
    !ts.isPropertyAccessExpression(node.expression) ||
    !HTTP_ROUTE_METHODS.has(node.expression.name.text) ||
    node.arguments.length < 2 ||
    !ts.isStringLiteralLike(node.arguments[0])
  ) {
    return false
  }

  const handler = node.arguments.at(-1)
  return Boolean(
    handler && (ts.isArrowFunction(handler) || ts.isFunctionExpression(handler))
  )
}

const collectApiRouteDiagnostics = (rootDir, sourceFile) => {
  const relative = normalizePath(path.relative(rootDir, sourceFile.fileName))
  if (
    !relative.startsWith('apps/api/src/routes/') ||
    /\.(?:test|integration\.test)\.[cm]?[jt]sx?$/.test(relative)
  ) {
    return []
  }

  const diagnostics = []
  const hasContractImport = collectModuleReferences(sourceFile).some(
    (reference) =>
      reference.runtime && reference.specifier.startsWith('@nihongo/contracts/')
  )
  const allowLocalSchemaNames = relative.endsWith('/health.ts')
  const responseSchemaBindings = {
    ...collectContractSchemaBindings(sourceFile, RESPONSE_SCHEMA_NAME_PATTERN),
    allowLocalName: allowLocalSchemaNames,
    namePattern: RESPONSE_SCHEMA_NAME_PATTERN
  }
  const requestSchemaBindings = {
    ...collectContractSchemaBindings(sourceFile, REQUEST_SCHEMA_NAME_PATTERN),
    allowLocalName: false,
    namePattern: REQUEST_SCHEMA_NAME_PATTERN
  }

  const visit = (node) => {
    if (isHttpRouteRegistration(node)) {
      const handler = node.arguments.at(-1)
      const routeKey = `${node.expression.name.text}:${node.arguments[0].text}`
      const sourceRouteKey = `${relative}#${routeKey}`
      const contextNames = getHandlerContextNames(handler)
      const jsonCalls = collectContextJsonCalls(handler, contextNames)
      const hasValidatedNoContentResponse =
        NO_CONTENT_API_ROUTE_SOURCES.has(sourceRouteKey) &&
        containsNoContentResponse(handler, contextNames)
      const validatedResponseBindings = collectValidatedResponseBindings(
        handler,
        responseSchemaBindings
      )
      const hasUnvalidatedResponse =
        (jsonCalls.length === 0 && !hasValidatedNoContentResponse) ||
        jsonCalls.some((call) => {
          const [response] = call.arguments
          return (
            !response ||
            !isValidatedResponseExpression(
              response,
              validatedResponseBindings,
              responseSchemaBindings
            )
          )
        })

      if (hasUnvalidatedResponse) {
        diagnostics.push(
          createDiagnostic(
            rootDir,
            sourceFile,
            node.expression.name,
            'ARCH112',
            'API routes must validate their response with a Zod contract'
          )
        )
      }

      if (
        !REQUESTLESS_API_ROUTES.has(routeKey) &&
        containsContextRequestAccess(handler, contextNames) &&
        !containsRequestSchemaParse(
          handler,
          contextNames,
          requestSchemaBindings
        )
      ) {
        diagnostics.push(
          createDiagnostic(
            rootDir,
            sourceFile,
            node.expression.name,
            'ARCH115',
            'API route request parts must be parsed with a Zod contract'
          )
        )
      }

      if (!relative.endsWith('/health.ts') && !hasContractImport) {
        diagnostics.push(
          createDiagnostic(
            rootDir,
            sourceFile,
            node.expression.name,
            'ARCH113',
            'application API routes must import an explicit canonical contract subpath'
          )
        )
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return diagnostics
}

const resolveWebModule = (rootDir, importerFile, specifier) => {
  let candidate
  if (specifier.startsWith('.')) {
    candidate = path.resolve(path.dirname(importerFile), specifier)
  } else {
    for (const [alias, target] of WEB_ALIAS_ROOTS) {
      if (specifier.startsWith(alias)) {
        candidate = path.join(
          rootDir,
          'apps/web/src',
          target,
          specifier.slice(alias.length)
        )
        break
      }
    }
  }

  if (!candidate) return null
  for (const suffix of ['', '.ts', '.tsx', '/index.ts', '/index.tsx']) {
    const fileName = `${candidate}${suffix}`
    if (fs.existsSync(fileName) && fs.statSync(fileName).isFile()) {
      return path.resolve(fileName)
    }
  }
  return null
}

const collectPublicWebContractDiagnostics = (rootDir, sourceFiles) => {
  const webFiles = sourceFiles.filter(
    (fileName) => classifyWorkspace(rootDir, fileName)?.id === 'apps/web'
  )
  const edges = new Map()
  const sensitiveCategories = new Map()

  const getSensitiveCategory = (specifier) => {
    if (!SENSITIVE_CONTRACT_PATTERN.test(specifier)) return null
    if (/^@nihongo\/contracts\/admin(?:-|\/)/.test(specifier)) {
      return 'admin'
    }
    if (/^@nihongo\/contracts\/dashboard(?:-|\/)/.test(specifier)) {
      return 'dashboard'
    }
    if (/wrong-note/.test(specifier)) return 'wrong-note'
    if (/reviewed/.test(specifier)) return 'reviewed'
    if (/submit/.test(specifier)) return 'study-submit'
    return 'study-result'
  }

  for (const fileName of webFiles) {
    const sourceText = fs.readFileSync(fileName, 'utf8')
    const sourceFile = ts.createSourceFile(
      fileName,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    )
    const dependencies = []
    const categories = []

    for (const reference of collectModuleReferences(sourceFile)) {
      if (!reference.runtime) continue
      const category = getSensitiveCategory(reference.specifier)
      if (category) {
        categories.push({
          category,
          deferred: reference.dynamic && reference.deferred
        })
      }
      const resolved = resolveWebModule(rootDir, fileName, reference.specifier)
      if (resolved) {
        dependencies.push({
          deferred: reference.dynamic && reference.deferred,
          fileName: resolved
        })
      }
    }
    edges.set(fileName, dependencies)
    sensitiveCategories.set(fileName, categories)
  }

  const collectReachableSensitiveCategories = (
    fileName,
    includeDynamic,
    visiting = new Set()
  ) => {
    const categories = new Set(
      (sensitiveCategories.get(fileName) ?? [])
        .filter((entry) => includeDynamic || !entry.deferred)
        .map((entry) => entry.category)
    )
    if (visiting.has(fileName)) return false
    visiting.add(fileName)

    for (const dependency of edges.get(fileName) ?? []) {
      if (!includeDynamic && dependency.deferred) continue
      const dependencyCategories = collectReachableSensitiveCategories(
        dependency.fileName,
        includeDynamic,
        new Set(visiting)
      )
      if (dependencyCategories === false) continue
      dependencyCategories.forEach((category) => categories.add(category))
    }

    return categories
  }

  return webFiles.flatMap((fileName) => {
    const relative = normalizePath(path.relative(rootDir, fileName))
    if (
      !PUBLIC_WEB_PATH_PATTERN.test(relative) ||
      TEST_SOURCE_PATH_PATTERN.test(relative)
    ) {
      return []
    }

    const allCategories = collectReachableSensitiveCategories(fileName, true)
    if (allCategories === false || allCategories.size === 0) return []

    if (OWNER_PRACTICE_SESSION_PATH_PATTERN.test(relative)) {
      const eagerCategories = collectReachableSensitiveCategories(
        fileName,
        false
      )
      const forbiddenLazyCategories = [...allCategories].filter(
        (category) => category !== 'study-submit' && category !== 'study-result'
      )

      if (
        eagerCategories !== false &&
        eagerCategories.size === 0 &&
        forbiddenLazyCategories.length === 0
      ) {
        return []
      }
    }

    return [
      createFileDiagnostic(
        rootDir,
        fileName,
        'ARCH114',
        'public question/home cannot reach sensitive contracts; owner practice/session may reach only lazy study submit/result contracts'
      )
    ]
  })
}

const collectPackageCycles = (graph) => {
  const cycles = []
  const visiting = new Set()
  const visited = new Set()
  const stack = []

  const visit = (node) => {
    if (visiting.has(node)) {
      const start = stack.indexOf(node)
      cycles.push([...stack.slice(start), node])
      return
    }

    if (visited.has(node)) return

    visiting.add(node)
    stack.push(node)

    for (const dependency of graph.get(node) ?? []) {
      visit(dependency)
    }

    stack.pop()
    visiting.delete(node)
    visited.add(node)
  }

  for (const node of graph.keys()) {
    visit(node)
  }

  return cycles
}

export const checkWorkspaceArchitecture = ({
  rootDir = defaultRootDir
} = {}) => {
  const absoluteRoot = path.resolve(rootDir)
  const sourceFiles = [
    ...walkFiles(path.join(absoluteRoot, 'apps')),
    ...walkFiles(path.join(absoluteRoot, 'packages'))
  ]
  const diagnostics = []
  const runtimeGraph = new Map()
  const graphSource = new Map()

  for (const fileName of sourceFiles) {
    const importer = classifyWorkspace(absoluteRoot, fileName)
    if (!importer) continue

    const sourceText = fs.readFileSync(fileName, 'utf8')
    const sourceFile = ts.createSourceFile(
      fileName,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    )

    diagnostics.push(...collectApiRouteDiagnostics(absoluteRoot, sourceFile))

    if (!runtimeGraph.has(importer.id)) {
      runtimeGraph.set(importer.id, new Set())
    }

    for (const reference of collectModuleReferences(sourceFile)) {
      const target = workspaceFromSpecifier(
        absoluteRoot,
        fileName,
        reference.specifier
      )

      if (importer.kind === 'package' && target?.kind === 'app') {
        diagnostics.push(
          createDiagnostic(
            absoluteRoot,
            sourceFile,
            reference.node,
            'ARCH101',
            'packages cannot depend on apps'
          )
        )
      }

      if (importer.id === 'apps/web' && target?.id === 'packages/domain') {
        diagnostics.push(
          createDiagnostic(
            absoluteRoot,
            sourceFile,
            reference.node,
            'ARCH102',
            'apps/web cannot depend on packages/domain'
          )
        )
      }

      if (
        (importer.id === 'packages/contracts' ||
          importer.id === 'packages/domain') &&
        isForbiddenPurePackageImport(reference.specifier)
      ) {
        diagnostics.push(
          createDiagnostic(
            absoluteRoot,
            sourceFile,
            reference.node,
            'ARCH103',
            'contracts/domain packages cannot import app frameworks, persistence libraries, or Node I/O'
          )
        )
      }

      if (
        (importer.id === 'packages/contracts' &&
          target?.id === 'packages/domain') ||
        (importer.id === 'packages/domain' &&
          target?.id === 'packages/contracts')
      ) {
        diagnostics.push(
          createDiagnostic(
            absoluteRoot,
            sourceFile,
            reference.node,
            'ARCH104',
            'contracts and domain cannot depend on each other'
          )
        )
      }

      if (
        importer.id === 'apps/web' &&
        reference.specifier === '@nihongo/contracts'
      ) {
        diagnostics.push(
          createDiagnostic(
            absoluteRoot,
            sourceFile,
            reference.node,
            'ARCH105',
            'apps/web must use an explicit contracts subpath'
          )
        )
      }

      if (reference.runtime && target && target.id !== importer.id) {
        runtimeGraph.get(importer.id).add(target.id)
        graphSource.set(`${importer.id}->${target.id}`, {
          sourceFile,
          node: reference.node
        })
      }
    }

    if (
      (importer.id === 'packages/contracts' ||
        importer.id === 'packages/domain') &&
      /\bprocess\s*\.\s*env\b/.test(sourceText)
    ) {
      diagnostics.push(
        createDiagnostic(
          absoluteRoot,
          sourceFile,
          sourceFile,
          'ARCH106',
          'contracts/domain packages cannot read process.env'
        )
      )
    }
  }

  diagnostics.push(...checkManifestArchitecture(absoluteRoot))
  diagnostics.push(
    ...collectPublicWebContractDiagnostics(absoluteRoot, sourceFiles)
  )

  for (const cycle of collectPackageCycles(runtimeGraph)) {
    const [from, to] = cycle
    const source = graphSource.get(`${from}->${to}`)

    if (!source) continue

    diagnostics.push(
      createDiagnostic(
        absoluteRoot,
        source.sourceFile,
        source.node,
        'ARCH107',
        `workspace runtime cycle detected: ${cycle.join(' -> ')}`
      )
    )
  }

  return diagnostics.sort(
    (left, right) =>
      left.file.localeCompare(right.file) ||
      left.line - right.line ||
      left.column - right.column ||
      left.code.localeCompare(right.code)
  )
}

export const formatWorkspaceDiagnostic = (diagnostic) =>
  `${diagnostic.file}:${diagnostic.line}:${diagnostic.column} [${diagnostic.code}] ${diagnostic.message}`
