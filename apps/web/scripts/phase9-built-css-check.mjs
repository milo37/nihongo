import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { stdout } from 'node:process'
import { fileURLToPath, URL } from 'node:url'
import { validateBuiltCssContract } from './phase9-built-css-contract.mjs'

const webRoot = fileURLToPath(new URL('..', import.meta.url))
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

stdout.write(
  `${JSON.stringify({ cssAsset: cssFiles[0], forcedColorsTabIndicator: true })}\n`
)
