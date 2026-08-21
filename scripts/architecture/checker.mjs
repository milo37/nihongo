import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { fileURLToPath } from 'node:url'

const RULES = {
  relativeImport: 'ARCH001',
  uiApiImport: 'ARCH002',
  queryBoundary: 'ARCH003',
  mockRepositoryBoundary: 'ARCH004',
  endpointValidation: 'ARCH005',
  runtimeCycle: 'ARCH006'
}

const normalizePath = (value) => value.split(path.sep).join('/')

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const defaultRootDir = path.resolve(scriptDirectory, '../..')
const METADATA_SAFE_WRAPPER_BY_ENDPOINT = new Map([
  ['api/bookmark/createBookmark/index.ts', 'safePutWithMetadata'],
  ['api/bookmark/deleteBookmark/index.ts', 'safeDelWithMetadata'],
  ['api/study/cancelStudySession/index.ts', 'safePostWithMetadata'],
  ['api/study/createStudySessionV2/index.ts', 'safePostWithMetadata'],
  ['api/study/getStudyDraftAnswers/index.ts', 'safeGetWithMetadata'],
  ['api/study/getStudySessionV2/index.ts', 'safeGetWithMetadata'],
  ['api/study/listResumableStudySessions/index.ts', 'safeGetWithMetadata'],
  ['api/study/saveStudyDraftAnswers/index.ts', 'safePutWithMetadata'],
  ['api/study/submitStudySessionV2/index.ts', 'safePostWithMetadata']
])
const METADATA_SAFE_WRAPPER_NAMES = new Set([
  'safeGetWithMetadata',
  'safePostWithMetadata',
  'safePutWithMetadata',
  'safeDelWithMetadata'
])
const METADATA_RAW_WRAPPER_NAMES = new Set([
  'getWithMetadata',
  'postWithMetadata',
  'putWithMetadata',
  'delWithMetadata'
])

const isPathInside = (parent, candidate) => {
  const relative = path.relative(parent, candidate)
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== '..' &&
      !path.isAbsolute(relative))
  )
}

const isTestFile = (fileName) => {
  const normalized = normalizePath(fileName)
  return (
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(normalized) ||
    normalized.includes('/src/test/')
  )
}

const isRuntimeImport = (node) => {
  if (!node.importClause) return true
  if (node.importClause.isTypeOnly) return false
  const bindings = node.importClause.namedBindings
  if (!bindings || !ts.isNamedImports(bindings)) return true
  return bindings.elements.some((element) => !element.isTypeOnly)
}

const getRuntimeImportBindings = (node) => {
  if (!node.importClause || node.importClause.isTypeOnly) return []
  const bindings = []

  if (node.importClause.name) {
    bindings.push(node.importClause.name)
  }

  const namedBindings = node.importClause.namedBindings
  if (namedBindings && ts.isNamespaceImport(namedBindings)) {
    bindings.push(namedBindings.name)
  } else if (namedBindings && ts.isNamedImports(namedBindings)) {
    for (const element of namedBindings.elements) {
      if (!element.isTypeOnly) bindings.push(element.name)
    }
  }

  return bindings
}

const createDiagnostic = (sourceFile, node, code, message, rootDir) => {
  const position = sourceFile.getLineAndCharacterOfPosition(
    node.getStart(sourceFile)
  )
  return {
    code,
    file: normalizePath(path.relative(rootDir, sourceFile.fileName)),
    line: position.line + 1,
    column: position.character + 1,
    message
  }
}

const readProject = (tsconfigPath) => {
  const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile)
  if (configFile.error) {
    throw new Error(
      ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n')
    )
  }

  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    path.dirname(tsconfigPath)
  )
  if (parsed.errors.length > 0) {
    throw new Error(
      parsed.errors
        .map((error) =>
          ts.flattenDiagnosticMessageText(error.messageText, '\n')
        )
        .join('\n')
    )
  }

  const program = ts.createProgram({
    rootNames: parsed.fileNames,
    options: parsed.options
  })

  return {
    checker: program.getTypeChecker(),
    parsed,
    program
  }
}

const resolveImport = (specifier, sourceFile, options) => {
  const resolution = ts.resolveModuleName(
    specifier,
    sourceFile.fileName,
    options,
    ts.sys
  ).resolvedModule

  if (!resolution) return null
  return path.resolve(resolution.resolvedFileName)
}

const getModuleReferences = (sourceFile) => {
  const references = []

  const visit = (node) => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      references.push({
        node: node.moduleSpecifier,
        specifier: node.moduleSpecifier.text,
        runtime: isRuntimeImport(node),
        declaration: node
      })
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const runtime =
        !node.isTypeOnly &&
        (!node.exportClause ||
          !ts.isNamedExports(node.exportClause) ||
          node.exportClause.elements.some((element) => !element.isTypeOnly))
      references.push({
        node: node.moduleSpecifier,
        specifier: node.moduleSpecifier.text,
        runtime,
        declaration: node
      })
    } else if (
      ts.isCallExpression(node) &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === 'require'))
    ) {
      references.push({
        node: node.arguments[0],
        specifier: node.arguments[0].text,
        runtime: true,
        declaration: node
      })
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return references
}

const isUiFile = (fileName, sourceRoot) => {
  const relative = normalizePath(path.relative(sourceRoot, fileName))
  return (
    /^app\/(?:.+\/)?(?:page|layout)\.tsx?$/.test(relative) ||
    /^app\/[^/]+\/(?:.+\/)?components\//.test(relative) ||
    relative.startsWith('common/components/')
  )
}

const isAllowedQueryFile = (fileName, sourceRoot) => {
  const relative = normalizePath(path.relative(sourceRoot, fileName))
  return (
    /^app\/[^/]+\/(?:.+\/)?(?:hooks|queries)\//.test(relative) ||
    relative.startsWith('provider/') ||
    relative === 'libs/queryClient.ts'
  )
}

const isAllowedMockRepositoryFile = (fileName, sourceRoot) => {
  const relative = normalizePath(path.relative(sourceRoot, fileName))
  return relative.startsWith('mocks/handlers/')
}

const canonicalCycleKey = (cycle, sourceRoot) => {
  const names = cycle
    .slice(0, -1)
    .map((fileName) => normalizePath(path.relative(sourceRoot, fileName)))
  const rotations = names.map((_, index) => [
    ...names.slice(index),
    ...names.slice(0, index)
  ])
  return rotations.map((items) => items.join(' -> ')).sort()[0]
}

const collectCycles = (graph, edgeNodes, sourceFiles, sourceRoot, rootDir) => {
  const diagnostics = []
  const state = new Map()
  const stack = []
  const seen = new Set()

  const visit = (fileName) => {
    state.set(fileName, 1)
    stack.push(fileName)

    for (const dependency of [...(graph.get(fileName) ?? [])].sort()) {
      const dependencyState = state.get(dependency) ?? 0
      if (dependencyState === 0) {
        visit(dependency)
        continue
      }

      if (dependencyState !== 1) continue
      const index = stack.indexOf(dependency)
      const cycle = [...stack.slice(index), dependency]
      const key = canonicalCycleKey(cycle, sourceRoot)
      if (seen.has(key)) continue
      seen.add(key)

      const sourceFile = sourceFiles.get(fileName)
      const edgeNode = edgeNodes.get(`${fileName}::${dependency}`)
      if (sourceFile && edgeNode) {
        diagnostics.push(
          createDiagnostic(
            sourceFile,
            edgeNode,
            RULES.runtimeCycle,
            `runtime import cycle: ${key}`,
            rootDir
          )
        )
      }
    }

    stack.pop()
    state.set(fileName, 2)
  }

  for (const fileName of [...graph.keys()].sort()) {
    if ((state.get(fileName) ?? 0) === 0) visit(fileName)
  }

  return diagnostics
}

const getResolvedSymbol = (checker, node) => {
  const symbol = checker.getSymbolAtLocation(node)
  if (!symbol) return null
  return symbol.flags & ts.SymbolFlags.Alias
    ? checker.getAliasedSymbol(symbol)
    : symbol
}

const isDeclaredInFile = (symbol, fileName) => {
  return Boolean(
    symbol?.declarations?.some(
      (declaration) =>
        path.resolve(declaration.getSourceFile().fileName) ===
        path.resolve(fileName)
    )
  )
}

const symbolResolvesToDeclaration = (
  checker,
  symbol,
  predicate,
  seen = new Set()
) => {
  if (!symbol || seen.has(symbol)) return null
  seen.add(symbol)
  if (predicate(symbol)) return symbol

  for (const declaration of symbol.declarations ?? []) {
    if (
      ts.isVariableDeclaration(declaration) &&
      declaration.initializer &&
      (ts.isIdentifier(declaration.initializer) ||
        ts.isPropertyAccessExpression(declaration.initializer))
    ) {
      const resolved = symbolResolvesToDeclaration(
        checker,
        getResolvedSymbol(checker, declaration.initializer),
        predicate,
        seen
      )
      if (resolved) return resolved
    }

    if (ts.isExportSpecifier(declaration)) {
      const resolved = symbolResolvesToDeclaration(
        checker,
        checker.getExportSpecifierLocalTargetSymbol(declaration),
        predicate,
        seen
      )
      if (resolved) return resolved
    }
  }

  return null
}

const getSymbolDeclarationFiles = (symbol) => {
  return (
    symbol?.declarations?.map((declaration) =>
      path.resolve(declaration.getSourceFile().fileName)
    ) ?? []
  )
}

const isTypeOnlyExportSymbol = (symbol) => {
  const declarations = symbol.declarations ?? []
  return (
    declarations.length > 0 &&
    declarations.every((declaration) => {
      if (ts.isExportSpecifier(declaration)) {
        const exportDeclaration = declaration.parent.parent
        return (
          declaration.isTypeOnly ||
          (ts.isExportDeclaration(exportDeclaration) &&
            exportDeclaration.isTypeOnly)
        )
      }

      if (ts.isNamespaceExport(declaration)) {
        const exportDeclaration = declaration.parent
        return (
          ts.isExportDeclaration(exportDeclaration) &&
          exportDeclaration.isTypeOnly
        )
      }

      return ts.isExportDeclaration(declaration) && declaration.isTypeOnly
    })
  )
}

const getSymbolProvenanceFiles = (checker, symbol, seen = new Set()) => {
  if (!symbol || seen.has(symbol)) return new Set()
  seen.add(symbol)
  const files = new Set(getSymbolDeclarationFiles(symbol))

  if (symbol.flags & ts.SymbolFlags.Module) {
    for (const exportedSymbol of checker.getExportsOfModule(symbol)) {
      if (isTypeOnlyExportSymbol(exportedSymbol)) continue
      const target =
        exportedSymbol.flags & ts.SymbolFlags.Alias
          ? checker.getAliasedSymbol(exportedSymbol)
          : exportedSymbol
      if (
        !target.valueDeclaration &&
        !(target.flags & (ts.SymbolFlags.Value | ts.SymbolFlags.Module))
      ) {
        continue
      }

      for (const file of getSymbolProvenanceFiles(checker, target, seen)) {
        files.add(file)
      }
    }
  }

  for (const declaration of symbol.declarations ?? []) {
    if (
      ts.isVariableDeclaration(declaration) &&
      declaration.initializer &&
      (ts.isIdentifier(declaration.initializer) ||
        ts.isPropertyAccessExpression(declaration.initializer))
    ) {
      const target = getResolvedSymbol(checker, declaration.initializer)
      for (const file of getSymbolProvenanceFiles(checker, target, seen)) {
        files.add(file)
      }
    }

    if (ts.isExportSpecifier(declaration)) {
      const target = checker.getExportSpecifierLocalTargetSymbol(declaration)
      for (const file of getSymbolProvenanceFiles(checker, target, seen)) {
        files.add(file)
      }
    }
  }

  return files
}

const symbolHasProvenance = (checker, node, predicate) => {
  const symbol = getResolvedSymbol(checker, node)
  return [...getSymbolProvenanceFiles(checker, symbol)].some(predicate)
}

const isZodDeclarationFile = (fileName) => {
  const normalized = normalizePath(fileName)
  return /\/node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?zod\//.test(
    normalized
  )
}

const isTanStackQueryDeclarationFile = (fileName) => {
  return /\/node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?@tanstack\/(?:react-query|query-core)\//.test(
    normalizePath(fileName)
  )
}

const isZodSchemaExpression = (checker, node) => {
  const type = checker.getTypeAtLocation(node)
  const safeParse = type.getProperty('safeParse')
  return Boolean(
    safeParse && getSymbolDeclarationFiles(safeParse).some(isZodDeclarationFile)
  )
}

const isGlobalFetchDeclarationFile = (fileName) => {
  return /lib\.(?:dom|webworker).*\.d\.ts$/.test(normalizePath(fileName))
}

const isGlobalFetchSymbol = (checker, symbol, seen = new Set()) => {
  if (!symbol || seen.has(symbol)) return false
  seen.add(symbol)

  if (
    symbol.getName() === 'fetch' &&
    getSymbolDeclarationFiles(symbol).some(isGlobalFetchDeclarationFile)
  ) {
    return true
  }

  for (const declaration of symbol.declarations ?? []) {
    if (
      ts.isBindingElement(declaration) &&
      ts.isObjectBindingPattern(declaration.parent)
    ) {
      const variableDeclaration = declaration.parent.parent
      const propertyName = declaration.propertyName ?? declaration.name
      if (
        ts.isVariableDeclaration(variableDeclaration) &&
        variableDeclaration.initializer &&
        (ts.isIdentifier(propertyName) || ts.isStringLiteral(propertyName))
      ) {
        const propertySymbol = checker
          .getTypeAtLocation(variableDeclaration.initializer)
          .getProperty(propertyName.text)
        if (isGlobalFetchSymbol(checker, propertySymbol, seen)) return true
      }
    }

    if (
      ts.isVariableDeclaration(declaration) &&
      declaration.initializer &&
      (ts.isIdentifier(declaration.initializer) ||
        ts.isPropertyAccessExpression(declaration.initializer)) &&
      isGlobalFetchSymbol(
        checker,
        getResolvedSymbol(checker, declaration.initializer),
        seen
      )
    ) {
      return true
    }

    if (
      ts.isExportSpecifier(declaration) &&
      isGlobalFetchSymbol(
        checker,
        checker.getExportSpecifierLocalTargetSymbol(declaration),
        seen
      )
    ) {
      return true
    }
  }

  return false
}

const hasGlobalFetchCall = (sourceFile, checker) => {
  let fetchNode = null

  const visit = (node) => {
    if (!fetchNode && ts.isCallExpression(node)) {
      const expression = node.expression
      const fetchReference = ts.isIdentifier(expression)
        ? expression
        : ts.isPropertyAccessExpression(expression)
          ? expression.name
          : null
      const isGlobalFetch =
        fetchReference &&
        isGlobalFetchSymbol(checker, getResolvedSymbol(checker, fetchReference))

      if (isGlobalFetch) {
        fetchNode = fetchReference
        return
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return fetchNode
}

const checkMetadataTransportBoundary = (
  sourceFile,
  sourceRoot,
  rootDir,
  checker
) => {
  const relative = normalizePath(path.relative(sourceRoot, sourceFile.fileName))
  if (relative === 'api/http.ts') return []

  const httpPath = path.resolve(sourceRoot, 'api/http.ts')
  const diagnostics = []
  const getCallReference = (expression) => {
    if (ts.isIdentifier(expression)) return expression
    if (ts.isPropertyAccessExpression(expression)) return expression.name
    return null
  }

  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const callReference = getCallReference(node.expression)
      const callSymbol = callReference
        ? getResolvedSymbol(checker, callReference)
        : null
      const httpWrapper = symbolResolvesToDeclaration(
        checker,
        callSymbol,
        (candidate) =>
          isDeclaredInFile(candidate, httpPath) &&
          (METADATA_SAFE_WRAPPER_NAMES.has(candidate.getName()) ||
            METADATA_RAW_WRAPPER_NAMES.has(candidate.getName()))
      )

      if (httpWrapper) {
        const wrapperName = httpWrapper.getName()
        const expectedWrapper = METADATA_SAFE_WRAPPER_BY_ENDPOINT.get(relative)
        const isAllowedSafeWrapper =
          METADATA_SAFE_WRAPPER_NAMES.has(wrapperName) &&
          expectedWrapper === wrapperName

        if (!isAllowedSafeWrapper) {
          diagnostics.push(
            createDiagnostic(
              sourceFile,
              callReference ?? node.expression,
              RULES.endpointValidation,
              'metadata HTTP wrappers are restricted to the exact sanctioned endpoint and verb',
              rootDir
            )
          )
        }
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return diagnostics
}

const checkEndpoint = (
  sourceFile,
  references,
  sourceRoot,
  rootDir,
  _options,
  checker
) => {
  const relative = normalizePath(path.relative(sourceRoot, sourceFile.fileName))
  if (!/^api\/[^/]+\/[^/]+\/index\.ts$/.test(relative)) return []

  const schemaPath = path.join(path.dirname(sourceFile.fileName), 'schema.ts')
  const schemaResolvedPath = path.resolve(schemaPath)
  if (!fs.existsSync(schemaPath)) {
    return [
      createDiagnostic(
        sourceFile,
        sourceFile,
        RULES.endpointValidation,
        'endpoint must have a sibling schema.ts',
        rootDir
      )
    ]
  }

  const httpPath = path.resolve(sourceRoot, 'api/http.ts')
  const configPath = path.resolve(sourceRoot, 'api/config.ts')
  const validatedRequestSymbols = new Set()
  const importsAxios = references.some(
    ({ runtime, specifier }) =>
      runtime && (specifier === 'axios' || specifier.startsWith('axios/'))
  )
  let rawTransportNode = null

  const getCallReference = (expression) => {
    if (ts.isIdentifier(expression)) return expression
    if (ts.isPropertyAccessExpression(expression)) return expression.name
    return null
  }

  const isSafeFactoryCall = (node) => {
    if (!ts.isCallExpression(node) || !node.arguments[0]) return false
    const callReference = getCallReference(node.expression)
    if (!callReference) return false
    const symbol = getResolvedSymbol(checker, callReference)
    const schemaArgument = node.arguments[0]
    const schemaSymbol = getResolvedSymbol(checker, schemaArgument)

    return Boolean(
      symbol &&
        /^safe(Get|Post|Put|Del)(WithMetadata)?$/.test(symbol.getName()) &&
        isDeclaredInFile(symbol, httpPath) &&
        isDeclaredInFile(schemaSymbol, schemaResolvedPath) &&
        isZodSchemaExpression(checker, schemaArgument)
    )
  }

  const isAxiosFile = (fileName) =>
    /\/node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?axios\//.test(
      normalizePath(fileName)
    )

  const symbolResolvesTo = (symbol, predicate, seen = new Set()) => {
    if (!symbol || seen.has(symbol)) return false
    seen.add(symbol)
    if (predicate(symbol)) return true

    for (const declaration of symbol.declarations ?? []) {
      if (
        ts.isVariableDeclaration(declaration) &&
        declaration.initializer &&
        (ts.isIdentifier(declaration.initializer) ||
          ts.isPropertyAccessExpression(declaration.initializer)) &&
        symbolResolvesTo(
          getResolvedSymbol(checker, declaration.initializer),
          predicate,
          seen
        )
      ) {
        return true
      }

      if (
        ts.isExportSpecifier(declaration) &&
        symbolResolvesTo(
          checker.getExportSpecifierLocalTargetSymbol(declaration),
          predicate,
          seen
        )
      ) {
        return true
      }
    }

    return false
  }

  const rawClientMethods = new Set(['get', 'post', 'put', 'delete', 'request'])
  const isApiClientSymbol = (symbol) =>
    symbolResolvesTo(
      symbol,
      (candidate) =>
        candidate.getName() === 'apiClient' &&
        isDeclaredInFile(candidate, configPath)
    )
  const isRawApiClientMethodSymbol = (symbol, seen = new Set()) => {
    if (!symbol || seen.has(symbol)) return false
    seen.add(symbol)

    for (const declaration of symbol.declarations ?? []) {
      if (
        ts.isVariableDeclaration(declaration) &&
        declaration.initializer &&
        ts.isPropertyAccessExpression(declaration.initializer) &&
        rawClientMethods.has(declaration.initializer.name.text) &&
        isApiClientSymbol(
          getResolvedSymbol(checker, declaration.initializer.expression)
        )
      ) {
        return true
      }

      if (
        ts.isBindingElement(declaration) &&
        ts.isObjectBindingPattern(declaration.parent)
      ) {
        const variableDeclaration = declaration.parent.parent
        const propertyName = declaration.propertyName ?? declaration.name
        if (
          ts.isVariableDeclaration(variableDeclaration) &&
          variableDeclaration.initializer &&
          (ts.isIdentifier(propertyName) || ts.isStringLiteral(propertyName)) &&
          rawClientMethods.has(propertyName.text) &&
          isApiClientSymbol(
            getResolvedSymbol(checker, variableDeclaration.initializer)
          )
        ) {
          return true
        }
      }

      if (
        ts.isExportSpecifier(declaration) &&
        isRawApiClientMethodSymbol(
          checker.getExportSpecifierLocalTargetSymbol(declaration),
          seen
        )
      ) {
        return true
      }
    }

    return false
  }

  const isRawTransportCall = (node) => {
    if (!ts.isCallExpression(node)) return false
    const callReference = getCallReference(node.expression)
    const callSymbol = callReference
      ? getResolvedSymbol(checker, callReference)
      : null

    if (
      symbolResolvesTo(
        callSymbol,
        (symbol) =>
          [
            'get',
            'post',
            'put',
            'del',
            'getWithMetadata',
            'postWithMetadata',
            'putWithMetadata',
            'delWithMetadata'
          ].includes(symbol.getName()) && isDeclaredInFile(symbol, httpPath)
      )
    ) {
      return true
    }

    if (isRawApiClientMethodSymbol(callSymbol)) {
      return true
    }

    if (
      callReference &&
      symbolHasProvenance(checker, callReference, isAxiosFile)
    ) {
      return true
    }

    if (
      callReference &&
      isGlobalFetchSymbol(checker, getResolvedSymbol(checker, callReference))
    ) {
      return true
    }

    if (ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text
      const receiver = node.expression.expression
      const receiverSymbol = getResolvedSymbol(checker, receiver)
      if (rawClientMethods.has(method) && isApiClientSymbol(receiverSymbol)) {
        return true
      }
    }

    return false
  }

  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      isSafeFactoryCall(node.initializer)
    ) {
      const symbol = getResolvedSymbol(checker, node.name)
      if (symbol) validatedRequestSymbols.add(symbol)
    }

    if (ts.isCallExpression(node) && isRawTransportCall(node)) {
      rawTransportNode = rawTransportNode ?? node.expression
    }

    ts.forEachChild(node, visit)
  }
  visit(sourceFile)

  rawTransportNode = rawTransportNode ?? hasGlobalFetchCall(sourceFile, checker)

  const unwrapExpression = (node) => {
    let current = node
    while (
      ts.isAwaitExpression(current) ||
      ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isTypeAssertionExpression(current) ||
      ts.isNonNullExpression(current) ||
      ts.isSatisfiesExpression(current)
    ) {
      current = current.expression
    }
    return current
  }

  const isValidatedRequestResult = (expression) => {
    const unwrapped = unwrapExpression(expression)
    if (!ts.isCallExpression(unwrapped)) return false
    const callReference = getCallReference(unwrapped.expression)
    const symbol = callReference
      ? getResolvedSymbol(checker, callReference)
      : null
    return Boolean(symbol && validatedRequestSymbols.has(symbol))
  }

  const allOwnReturnsUseValidation = (functionLike) => {
    if (!functionLike.body) return false
    if (!ts.isBlock(functionLike.body)) {
      return isValidatedRequestResult(functionLike.body)
    }

    const returns = []
    const validatedResultSymbols = new Set()
    const inspect = (node) => {
      if (node !== functionLike.body && ts.isFunctionLike(node)) {
        return
      }
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer &&
        ts.isVariableDeclarationList(node.parent) &&
        (node.parent.flags & ts.NodeFlags.Const) !== 0 &&
        isValidatedRequestResult(node.initializer)
      ) {
        const symbol = getResolvedSymbol(checker, node.name)
        if (symbol) validatedResultSymbols.add(symbol)
      }
      if (ts.isReturnStatement(node)) {
        returns.push(node)
        return
      }
      ts.forEachChild(node, inspect)
    }
    inspect(functionLike.body)
    return (
      returns.length > 0 &&
      returns.every((returnStatement) => {
        if (!returnStatement.expression) return false
        if (isValidatedRequestResult(returnStatement.expression)) return true
        const returned = unwrapExpression(returnStatement.expression)
        if (!ts.isIdentifier(returned)) return false
        const symbol = getResolvedSymbol(checker, returned)
        return Boolean(symbol && validatedResultSymbols.has(symbol))
      })
    )
  }

  const returnsValidatedRequest = (declaration) => {
    if (
      ts.isVariableDeclaration(declaration) &&
      declaration.initializer &&
      isSafeFactoryCall(declaration.initializer)
    ) {
      return true
    }

    if (
      ts.isVariableDeclaration(declaration) &&
      declaration.initializer &&
      (ts.isArrowFunction(declaration.initializer) ||
        ts.isFunctionExpression(declaration.initializer))
    ) {
      return allOwnReturnsUseValidation(declaration.initializer)
    }

    if (ts.isFunctionDeclaration(declaration)) {
      return allOwnReturnsUseValidation(declaration)
    }

    return false
  }

  const moduleSymbol = checker.getSymbolAtLocation(sourceFile)
  const callableExports = moduleSymbol
    ? checker.getExportsOfModule(moduleSymbol).flatMap((exportedSymbol) => {
        const symbol =
          exportedSymbol.flags & ts.SymbolFlags.Alias
            ? checker.getAliasedSymbol(exportedSymbol)
            : exportedSymbol
        const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0]
        if (!declaration) return []
        const type = checker.getTypeOfSymbolAtLocation(symbol, declaration)
        return type.getCallSignatures().length > 0 ? [declaration] : []
      })
    : []

  const exportsUseValidation =
    callableExports.length > 0 && callableExports.every(returnsValidatedRequest)

  if (exportsUseValidation && !rawTransportNode && !importsAxios) {
    return []
  }

  return [
    createDiagnostic(
      sourceFile,
      rawTransportNode ?? sourceFile,
      RULES.endpointValidation,
      'endpoint must use a sanctioned safe HTTP wrapper with a sibling Zod schema and no raw transport',
      rootDir
    )
  ]
}

export const checkArchitecture = ({
  rootDir = defaultRootDir,
  tsconfigPath = path.join(rootDir, 'apps/web/tsconfig.json'),
  sourceRoot = path.join(rootDir, 'apps/web/src')
} = {}) => {
  const absoluteRoot = path.resolve(rootDir)
  const absoluteSourceRoot = path.resolve(sourceRoot)
  const { checker, parsed, program } = readProject(path.resolve(tsconfigPath))
  const diagnostics = []
  const graph = new Map()
  const edgeNodes = new Map()
  const sourceFiles = new Map()

  const applicationFiles = program
    .getSourceFiles()
    .filter(
      (sourceFile) =>
        !sourceFile.isDeclarationFile &&
        isPathInside(absoluteSourceRoot, path.resolve(sourceFile.fileName))
    )

  for (const sourceFile of applicationFiles) {
    const absoluteFile = path.resolve(sourceFile.fileName)
    const references = getModuleReferences(sourceFile)
    sourceFiles.set(absoluteFile, sourceFile)

    for (const reference of references) {
      if (reference.specifier.startsWith('.')) {
        diagnostics.push(
          createDiagnostic(
            sourceFile,
            reference.node,
            RULES.relativeImport,
            `relative import is not allowed: ${reference.specifier}`,
            absoluteRoot
          )
        )
      }

      if (!reference.runtime || isTestFile(absoluteFile)) continue

      const runtimeBindings = ts.isImportDeclaration(reference.declaration)
        ? getRuntimeImportBindings(reference.declaration)
        : []
      const resolved = resolveImport(
        reference.specifier,
        sourceFile,
        parsed.options
      )
      const resolvedSourceFile = resolved
        ? program.getSourceFile(resolved)
        : undefined
      const dynamicModuleSymbol =
        ts.isCallExpression(reference.declaration) && resolvedSourceFile
          ? checker.getSymbolAtLocation(resolvedSourceFile)
          : null
      const hasReferenceProvenance = (predicate) =>
        runtimeBindings.some((binding) =>
          symbolHasProvenance(checker, binding, predicate)
        ) ||
        (dynamicModuleSymbol
          ? [...getSymbolProvenanceFiles(checker, dynamicModuleSymbol)].some(
              predicate
            )
          : false)
      const hasQueryProvenance = hasReferenceProvenance(
        isTanStackQueryDeclarationFile
      )
      const hasAxiosProvenance = hasReferenceProvenance((fileName) =>
        /\/node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?axios\//.test(
          normalizePath(fileName)
        )
      )

      if (
        (reference.specifier === '@tanstack/react-query' ||
          reference.specifier.startsWith('@tanstack/react-query/') ||
          hasQueryProvenance) &&
        !isAllowedQueryFile(absoluteFile, absoluteSourceRoot)
      ) {
        diagnostics.push(
          createDiagnostic(
            sourceFile,
            reference.node,
            RULES.queryBoundary,
            'TanStack Query runtime primitives are restricted to hooks, queries, providers, and queryClient',
            absoluteRoot
          )
        )
      }

      if (
        isUiFile(absoluteFile, absoluteSourceRoot) &&
        (reference.specifier === 'axios' ||
          reference.specifier.startsWith('axios/') ||
          hasAxiosProvenance)
      ) {
        diagnostics.push(
          createDiagnostic(
            sourceFile,
            reference.node,
            RULES.uiApiImport,
            'UI page/component cannot import Axios runtime values',
            absoluteRoot
          )
        )
      }

      if (!resolved) continue
      const normalizedResolved = normalizePath(resolved)
      const hasApiProvenance = hasReferenceProvenance((fileName) =>
        isPathInside(
          path.resolve(absoluteSourceRoot, 'api'),
          path.resolve(fileName)
        )
      )
      const hasMockRepositoryProvenance = hasReferenceProvenance((fileName) =>
        isPathInside(
          path.resolve(absoluteSourceRoot, 'mocks/repository'),
          path.resolve(fileName)
        )
      )

      if (
        isUiFile(absoluteFile, absoluteSourceRoot) &&
        (normalizedResolved.includes('/src/api/') || hasApiProvenance)
      ) {
        diagnostics.push(
          createDiagnostic(
            sourceFile,
            reference.node,
            RULES.uiApiImport,
            'UI page/component cannot import API runtime values',
            absoluteRoot
          )
        )
      }

      if (
        (normalizedResolved.includes('/src/mocks/repository/') ||
          hasMockRepositoryProvenance) &&
        !isAllowedMockRepositoryFile(absoluteFile, absoluteSourceRoot)
      ) {
        diagnostics.push(
          createDiagnostic(
            sourceFile,
            reference.node,
            RULES.mockRepositoryBoundary,
            'Mock Repository runtime imports are restricted to MSW handlers',
            absoluteRoot
          )
        )
      }

      if (isPathInside(absoluteSourceRoot, resolved) && !isTestFile(resolved)) {
        if (!graph.has(absoluteFile)) graph.set(absoluteFile, new Set())
        graph.get(absoluteFile).add(resolved)
        edgeNodes.set(`${absoluteFile}::${resolved}`, reference.node)
      }
    }

    if (
      isUiFile(absoluteFile, absoluteSourceRoot) &&
      !isTestFile(absoluteFile)
    ) {
      const fetchNode = hasGlobalFetchCall(sourceFile, checker)
      if (fetchNode) {
        diagnostics.push(
          createDiagnostic(
            sourceFile,
            fetchNode,
            RULES.uiApiImport,
            'UI page/component cannot call global fetch directly',
            absoluteRoot
          )
        )
      }
    }

    if (!isTestFile(absoluteFile)) {
      if (!graph.has(absoluteFile)) graph.set(absoluteFile, new Set())
      diagnostics.push(
        ...checkMetadataTransportBoundary(
          sourceFile,
          absoluteSourceRoot,
          absoluteRoot,
          checker
        )
      )
      diagnostics.push(
        ...checkEndpoint(
          sourceFile,
          references,
          absoluteSourceRoot,
          absoluteRoot,
          parsed.options,
          checker
        )
      )
    }
  }

  diagnostics.push(
    ...collectCycles(
      graph,
      edgeNodes,
      sourceFiles,
      absoluteSourceRoot,
      absoluteRoot
    )
  )

  return diagnostics.sort(
    (left, right) =>
      left.file.localeCompare(right.file) ||
      left.line - right.line ||
      left.column - right.column ||
      left.code.localeCompare(right.code)
  )
}

export const formatArchitectureDiagnostic = (diagnostic) =>
  `${diagnostic.file}:${diagnostic.line}:${diagnostic.column} [${diagnostic.code}] ${diagnostic.message}`
