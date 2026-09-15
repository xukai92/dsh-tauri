# dsh-tauri

English | [中文](README.zh.md)

A native macOS desktop shell for the DeepSeek Harness Web GUI. It is a thin [Tauri](https://tauri.app) wrapper over the existing web profile: it spawns `dsh --profile web`, discovers the loopback URL the host prints on readiness, and opens that URL in a native system webview (`WKWebView` on macOS).

The entire GUI is dsh's own frontend — this crate is only the window and the process supervisor. The webview talks to the host over the ordinary same-origin loopback HTTP/RPC interface (the `/api` fetch envelope and event WebSockets), exactly as a browser would, so the `apps/web` frontend needs no changes and there is no Tauri IPC bridge for application RPC. The small connection prompt uses one shell-owned Tauri command only to navigate windows.

## How it works

1. `run()` spawns the bundled `dsh-web` sidecar — the maintained Python SDK runtime executable copied into Tauri's `externalBin` naming by `scripts/build-tauri-sidecar.ts` — with `--profile web --port 0 --no-open` (`--port 0` lets the OS pick a free port so two shells never collide). When no adjacent bundled sidecar exists, `DSH_BIN` supplies the development binary before the `PATH` fallback.
2. A worker thread reads the host's stdout until it finds the readiness line `dsh web: http://127.0.0.1:<port>`, then preserves its complete URL, including any authentication query.
3. A `WebviewWindowBuilder` opens window `main` on that external URL.
4. The child process is held in Tauri managed state. A normal application exit explicitly gives the host six seconds to dispose its PTYs and detached tool processes, then kills the remaining host process group.

See `src-tauri/src/dsh.rs` for the supervisor and URL parser (with unit tests), and `src-tauri/src/lib.rs` for the wiring.

## Prerequisites

- **macOS 13+** (the bundle is macOS-only today; the same Rust also compiles on Linux/Windows once those dependencies are present).
- **Rust** 1.77.2+ (`rustup`).
- **Tauri CLI** — either `pnpm` (the `@tauri-apps/cli` devDependency) or `cargo install tauri-cli`.

## Run (development)

```sh
# from this directory (apps/tauri)
pnpm install            # in the repo root, once
pnpm tauri dev          # or: cargo tauri dev
```

The window opens on the served GUI. `dsh`'s stderr is inherited, so host diagnostics appear in your terminal. In development the sidecar is not bundled, so `DSH_BIN` (or `dsh` on `PATH`) is used.

## Build the macOS app

```sh
node --import tsx/esm scripts/build-tauri-sidecar.ts --targets node24-macos-arm64
pnpm tauri build        # from apps/tauri
```

The first step delegates to `scripts/build-exe-for-python-sdk.ts`, which uses the root's patched `@yao-pkg/pkg`, maintained runtime closure, and bootstrap. The adapter copies its executable, node-pty spawn helper, and ripgrep sidecar into `apps/tauri/binaries/`; `tauri build` bundles all three. It produces `src-tauri/target/release/bundle/macos/DeepSeek Harness.app` and a `.dmg`. Building the `.app`/`.dmg` requires macOS; `cargo check`/`cargo build` of the Rust itself works on Linux with the WebKitGTK 4.1 development packages installed.

The desktop release version is the literal `version` in `src-tauri/tauri.conf.json`; Cargo's version must match it. The private npm manifest is workspace tooling metadata and may follow repository-wide version automation. Pushing a matching `tauri-v<version>` tag runs the macOS workflow and creates a GitHub Release containing the built DMG; prerelease versions create GitHub prereleases. Branch, pull-request, and untagged manual runs retain only the seven-day Actions artifact.

## Verify from source

The supervisor tests need only `rustc`; the smoke command launches the real source CLI with an isolated home, local model service, and test-only Bash path.

```sh
rustc --edition=2021 --test apps/tauri/src-tauri/tests/supervisor.rs -o /tmp/dsh-supervisor-test
/tmp/dsh-supervisor-test
node --import tsx/esm scripts/smoke-tauri-bundle.ts --source-cli
```

## Configuration

- `DSH_BIN` — binary to spawn when no `dsh-web` exists beside the application executable (default fallback: `dsh` on `PATH`).
- `DSH_REMOTE_URL=http://host:port/?token=…` — remote mode: load an already-running `dsh --profile web` host instead of spawning the local sidecar. Paste the complete printed launch URL on first connection; a plain origin has no authentication token and returns HTTP 401. The **Connection ▸ Connect to Remote…** menu item does the same interactively.
- Everything else (API key, `DSH_HOME`, …) is dsh's own configuration and passes through the inherited environment. A `DEEPSEEK_API_KEY` is only needed to actually run an agent; the GUI opens without one.

## Known limitations and next steps

- **Native adjuncts.** The sidecar is accompanied by node-pty's executable `dsh-web-spawn-helper` and the `dsh-web-rg` ripgrep binary. The macOS workflow checks their final `.app` locations, then exercises the signed sidecar's authenticated frontend/RPC, image normalization, persistent terminal, ripgrep, settings, and shutdown paths. It also launches the application and requests a normal macOS Quit.
- **Bounded hard-stop scope.** Graceful shutdown lets the CLI dispose detached subprocess groups and PTY sessions. If that path hangs, the supervisor's hard stop covers the sidecar's own process group; it cannot guarantee cleanup of an arbitrary process that detached into another group.
- **Loopback HTTP, no IPC bridge.** We use the authenticated `http://127.0.0.1:<port>` transport a browser uses. The shell does not expose a second RPC implementation.
- **Placeholder icons.** Generated from `apps/web/public/favicon.svg`; replace with a proper branded icon set before shipping.
- **Ad-hoc signature.** The explicit `-` signing identity prevents Apple Silicon downloads from being reported as damaged. This keyless build disables the hardened runtime because the embedded Node/V8 sidecar needs executable memory; the release workflow verifies the bundle signature and exercises the signed sidecar and application before publication. Because the app is not notarized, first launch can still require approval in **System Settings ▸ Privacy & Security**. Warning-free distribution needs a Developer ID Application certificate and Apple notarization credentials in CI.
