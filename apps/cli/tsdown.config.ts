import { defineConfig } from 'tsdown'

/**
 * The dsh CLI ships two entries: the `bin` referenced by package.json `bin`,
 * and `packaged-bin` used by the single-file web sidecar (it resolves bare
 * plugins from the packaged VFS). The root tsdown builds only
 * `lib/types/index.js`, so this override points at the two bins instead; their
 * reachable mode modules bundle with them. Declarations come from `tsc -b`
 * (dts: false), matching every package.
 */
export default defineConfig({
  entry: ['lib/types/bin.js', 'lib/types/packaged-bin.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})
