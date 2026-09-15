# Tauri fork

This branch carries a narrow Tauri macOS carrier over the 2026-09-15 upstream DeepSeek Harness revision recorded in six-character groups as `0d1f50-007f9b-ca3f52-b06e1c-3074fa-14d5fb-0720`; removing the separators yields the exact Git SHA. It ports intent rather than replaying the earlier fork history.

## Patch inventory

- Authenticated Web Hosts may bind an explicitly configured non-loopback address. Host settings persist through the existing settings provider while token/cookie authentication, Host/Origin checks, and desktop-native action restrictions remain unchanged. The browser regression uses insecure `http://remote.test`, asserts the absence of a secure context and `crypto.randomUUID`, completes authenticated RPC, persists the welcome acknowledgement, and proves it remains settled after reload.
- `apps/tauri` is a thin macOS system-webview shell over `dsh web`. Its adapter reuses the maintained Python SDK executable builder and runtime closure, then bundles the executable, node-pty spawn helper, and ripgrep companion under Tauri `externalBin` names. The [Tauri shell Agent Note](.agents/notes/implemented/architecture/2026-09-15-tauri-thin-web-shell.md) owns lifecycle and verification details.
- Tauri releases use the independent `tauri-v<version>` tag family. `apps/tauri/src-tauri/tauri.conf.json` is the desktop version authority and Cargo matches it; the private npm workspace version remains repository-tooling metadata.

No package-wide version changes, legacy sidecar closure, packaged CLI bootstrap, UUID fallback, VFS workaround, annotation feature, Herdr skill, or release-family rewrite belongs to this fork layer.

## Upstream integration checklist

1. Rebase the two logical fork commits onto the selected upstream revision and resolve behavior by current APIs rather than restoring deleted packages or generated catalogs.
2. Confirm the remote-host tests still exercise token exchange through a real loopback socket with a deliberate non-loopback Host header; Chromium-only DNS mapping is insufficient for the server-side scaffold fetch.
3. Confirm `scripts/build-tauri-sidecar.ts` remains only an adapter over `scripts/build-exe-for-python-sdk.ts`, uses root `pnpm exec pkg` indirectly, and copies every required executable companion.
4. Run focused Host/settings tests, the insecure-HTTP browser regression, the source Tauri smoke, supervisor tests, scoped static checks, and documentation synchronization. Run the signed bundle and normal-Quit smoke on macOS before publication.
5. Compare the Tauri configuration and Cargo versions before creating a `tauri-v` tag. Do not infer the desktop version from the private npm manifest or root release family.

## Durable data

Tests set fresh temporary `DSH_HOME`, `DSH_AGENTS_HOME`, credential inputs, and workspace paths; they never inspect or mutate a user's Harness home. Current Session format v3 retains the released adjacent migration chain: an accepted v0 log is read into a new version-named successor while the predecessor remains unchanged. Rebase verification uses the committed v0 migration fixture under temporary storage rather than real user data.

## Stage 1 checkpoint

The pre-integration Stage 1 branch passed 7 cross-platform supervisor tests, the full source runtime smoke, the insecure-HTTP browser replay, build and scoped checks. macOS Actions run `35010702817` additionally passed signed bundle inventory, frontend/RPC/settings/image/PTY/descendant cleanup, and actual application normal-Quit cleanup. The preserved safety and `stage1/macos-bundle-regressions` branches retain the original baseline and reviewed Stage 1 history.
