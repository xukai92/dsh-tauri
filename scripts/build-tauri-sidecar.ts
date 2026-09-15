/** Build the maintained SDK runtime and copy its macOS products for Tauri. */

import { spawn } from 'node:child_process'
import { chmod, copyFile, mkdir } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

const root = resolve(import.meta.dirname, '..')
const sourceBase = 'deepseek-harness-sdk-runtime'
const destinationBase = 'dsh-web'

interface Target {
  /** The pkg target accepted by the maintained executable builder. */
  spec: string
  /** The platform and architecture suffix on its build products. */
  productSuffix: string
  /** The Rust target suffix required by Tauri external binaries. */
  tauriSuffix: string
}

/**
 * Parse one supported macOS pkg target.
 * @param spec - A `node<major>-macos-<arch>` target.
 * @returns The source and Tauri suffixes for the target.
 */
export function parseTarget(spec: string): Target {
  const match = /^(node\d+)-macos-(arm64|x64)$/.exec(spec)
  if (match === null) {
    throw new Error(`Tauri sidecars require node<major>-macos-(arm64|x64), got ${JSON.stringify(spec)}.`)
  }
  const arch = match[2]
  return {
    spec,
    productSuffix: `macos-${arch}`,
    tauriSuffix: arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin',
  }
}

/** Run a child command and reject when it fails. */
async function run(command: string, args: readonly string[]): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise()
      else reject(new Error(`${basename(command)} exited with ${signal === null ? `code ${String(code)}` : `signal ${signal}`}.`))
    })
  })
}

/** Copy one executable while preserving its executable role. */
async function copyExecutable(source: string, destination: string): Promise<void> {
  await copyFile(source, destination)
  await chmod(destination, 0o755)
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      targets: { type: 'string' },
      'skip-build': { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
    },
  })
  const specs = (values.targets ?? 'node24-macos-arm64')
    .split(',')
    .map(value => value.trim())
    .filter(value => value !== '')
  if (specs.length === 0) throw new Error('--targets must name at least one macOS target.')
  const targets = specs.map(parseTarget)
  await run(process.execPath, [
    '--import',
    'tsx/esm',
    'scripts/build-exe-for-python-sdk.ts',
    '--targets',
    specs.join(','),
    ...(values['skip-build'] ? ['--skip-build'] : []),
    ...(values['dry-run'] ? ['--dry-run'] : []),
  ])
  const outputDirectory = join(root, 'apps/tauri/binaries')
  if (!values['dry-run']) await mkdir(outputDirectory, { recursive: true })
  for (const target of targets) {
    const source = join(root, 'dist-exe', `${sourceBase}-${target.productSuffix}`)
    const products = [
      { source, destination: join(outputDirectory, `${destinationBase}-${target.tauriSuffix}`) },
      { source: `${source}-spawn-helper`, destination: join(outputDirectory, `${destinationBase}-spawn-helper-${target.tauriSuffix}`) },
      { source: `${source}-rg`, destination: join(outputDirectory, `${destinationBase}-rg-${target.tauriSuffix}`) },
    ]
    for (const product of products) {
      if (values['dry-run']) {
        console.log(`build-tauri-sidecar: [dry-run] cp ${product.source} ${product.destination}`)
      } else {
        await copyExecutable(product.source, product.destination)
      }
    }
  }
}

await main()
