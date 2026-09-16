# Tauri fork

This branch carries a narrow Tauri macOS carrier over the 2026-09-15 upstream DeepSeek Harness revision. Run `git merge-base HEAD upstream/master` to recover the base revision. The branch ports intent rather than replaying the earlier fork history.

## Patch inventory

- Authenticated Web Hosts may bind an explicitly configured non-loopback address. Host settings persist through the existing settings provider while token/cookie authentication, Host/Origin checks, and desktop-native action restrictions remain unchanged. The browser regression uses insecure `http://remote.test`, asserts the absence of a secure context and `crypto.randomUUID`, completes authenticated RPC, persists the welcome acknowledgement, and proves it remains settled after reload.
- `apps/tauri` is a thin macOS system-webview shell over `dsh web`. Its adapter reuses the maintained Python SDK executable builder and runtime closure, then bundles the executable, node-pty spawn helper, and ripgrep companion under Tauri `externalBin` names. The [Tauri shell Agent Note](.agents/notes/implemented/architecture/2026-09-15-tauri-thin-web-shell.md) owns lifecycle and verification details.
- Tauri releases use the independent `tauri-v<version>` tag family. `apps/tauri/src-tauri/tauri.conf.json` is the desktop version authority and Cargo matches it; the private npm workspace version remains repository-tooling metadata.
- Downstream CI uses standard public GitHub-hosted runners and bounded worker counts while the upstream repository retains its custom, self-hosted, and Blacksmith runner selection. The [downstream CI Agent Note](.agents/notes/implemented/process/2026-09-16-downstream-hosted-ci.md) records runner, post-merge, and live-API policy.

No package-wide version changes, legacy sidecar closure, packaged CLI bootstrap, UUID fallback, VFS workaround, annotation feature, Herdr skill, or release-family rewrite belongs to this fork layer.

## Upstream integration checklist

1. Rebase the fork feature patches and downstream CI adaptation onto the selected upstream revision, resolving behavior through current APIs rather than restoring deleted packages or generated catalogs.
2. Confirm the remote-host tests still exercise token exchange through a real loopback socket with a deliberate non-loopback Host header; Chromium-only DNS mapping is insufficient for the server-side scaffold fetch.
3. Confirm `scripts/build-tauri-sidecar.ts` remains only an adapter over `scripts/build-exe-for-python-sdk.ts`, uses root `pnpm exec pkg` indirectly, and copies every required executable companion.
4. Run focused Host/settings tests, the insecure-HTTP browser regression, the source Tauri smoke, supervisor tests, scoped static checks, and documentation synchronization. Run the signed bundle and normal-Quit smoke on macOS before publication.
5. Compare the Tauri configuration and Cargo versions before creating a `tauri-v` tag. Do not infer the desktop version from the private npm manifest or root release family.
6. Keep `main` and `master` in useful post-merge workflow triggers. Recheck every owner-qualified runner selector, setup condition, worker budget, and live-API caller after upstream workflow changes.

## CI operations

Pull-request validation, release-shaped Python runtime builds, release package checks, sandbox tests, and native-addon platform tests run on standard public GitHub-hosted runners in this repository. Upstream-only hardware comparisons and self-hosted standby drills remain available in source but do not allocate unavailable downstream runner labels.

The reusable Python runtime builder always runs its installed-wheel keyless checks. Automatic upstream callers may also select the live DeepSeek API smoke; downstream live-API execution requires an explicit manual `real_api` dispatch and fails during preflight when its secret is absent. The dedicated real-API E2E workflow runs automatically only upstream and is manual downstream.

Repository settings disable these eight organization or publication workflows: Build PR preview, Deploy documentation, Issue lifecycle, Issue policy, Landlock Run Release, Release publish (dsh), Release publish (vendor), and weighted-approval. The active Release (dsh) and Release (vendor) workflows are package validation checks; they do not publish releases.

## Durable data

Tests set fresh temporary `DSH_HOME`, `DSH_AGENTS_HOME`, credential inputs, and workspace paths; they never inspect or mutate a user's Harness home. Current Session format v3 retains the released adjacent migration chain: an accepted v0 log is read into a new version-named successor while the predecessor remains unchanged. Rebase verification uses the committed v0 migration fixture under temporary storage rather than real user data.

## Stage 1 checkpoint

The preserved `stage1/macos-bundle-regressions` branch passed 7 cross-platform supervisor tests, the full source runtime smoke, the insecure-HTTP browser replay, build and scoped checks. macOS Actions run `35010702817` additionally passed signed bundle inventory, frontend/RPC/settings/image/PTY/descendant cleanup, and actual application normal-Quit cleanup. The branches returned by `git branch --list 'safety/*'` retain the original baseline.
