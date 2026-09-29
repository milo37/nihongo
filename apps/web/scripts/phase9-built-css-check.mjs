import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { stdout } from 'node:process'
import { fileURLToPath, URL } from 'node:url'
import { validateBuiltCssContract } from './phase9-built-css-contract.mjs'
import { validateProductionBundleRuntime } from './phase9-production-bundle-contract.mjs'

const webRoot = fileURLToPath(new URL('..', import.meta.url))
const distRoot = resolve(webRoot, 'dist')
const assetsRoot = resolve(webRoot, 'dist/assets')
const cssFiles = (await readdir(assetsRoot)).filter((file) =>
  /^index-.*\.css$/u.test(file)
)

if (cssFiles.length !== 1) {
  throw new Error(
    `Expected one built index CSS asset, received ${cssFiles.length}`
  )
}

const css = await readFile(resolve(assetsRoot, cssFiles[0]), 'utf8')
validateBuiltCssContract(css)

const collectBundleAssets = async (directory, relativeDirectory = '') => {
  const entries = await readdir(directory, { withFileTypes: true })
  const assets = []
  for (const entry of entries) {
    const relativePath = relativeDirectory
      ? `${relativeDirectory}/${entry.name}`
      : entry.name
    const absolutePath = resolve(directory, entry.name)
    if (entry.isDirectory()) {
      assets.push(...(await collectBundleAssets(absolutePath, relativePath)))
    } else if (entry.isFile()) {
      assets.push({
        path: relativePath,
        source: await readFile(absolutePath, 'utf8')
      })
    }
  }
  return assets
}

const bundleAssets = await collectBundleAssets(distRoot)
validateProductionBundleRuntime(bundleAssets)

stdout.write(
  `${JSON.stringify({ axeRuntimeMarkers: 0, cssAsset: cssFiles[0], forcedColorsAnsweredQuestionIndicator: true, forcedColorsTabIndicator: true, scannedBundleAssets: bundleAssets.length })}\n`
)
