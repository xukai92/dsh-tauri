# dsh-tauri

English | [中文](README.zh.md)

A native macOS desktop shell for the DeepSeek Harness Web GUI. It is a thin
[Tauri](https://tauri.app) wrapper over the existing web profile: it spawns
`dsh --profile web`, discovers the loopback URL the host prints on readiness,
and opens that URL in a native system webview (`WKWebView` on macOS).

The entire GUI is dsh's own frontend — this crate is only the window and the
process supervisor. The webview talks to the host over the ordinary
same-origin loopback HTTP/RPC surface (the `/api` fetch envelope and the event
WebSockets), exactly as a browser would, so the `apps/web` frontend needs no
changes and there is no Tauri IPC bridge.

## How it works

1. `run()` spawns the bundled `dsh-web` sidecar — a single-file exe built by
   `scripts/build-tauri-sidecar.ts` (`@yao-pkg/pkg --sea` over the web profile's
   closure) and embedded via Tauri `externalBin` — with
   `--profile web --port 0 --no-open` (`--port 0` lets the OS pick a free port
   so two shells never collide). When no adjacent bundled sidecar exists,
   `DSH_BIN` supplies the development binary before the `PATH` fallback.
2. A worker thread reads the host's stdout until it finds the readiness line
   `dsh web: http://127.0.0.1:<port>`, then preserves its complete URL,
   including any authentication query.
3. A `WebviewWindowBuilder` opens window `main` on that external URL.
4. The child process is held in Tauri managed state. A normal application exit
   explicitly gives the host six seconds to dispose its PTYs and detached tool
   processes, then kills the remaining host process group.

The shell also sets `DYLD_LIBRARY_PATH`/`LD_LIBRARY_PATH` to the bundled
`sharp-libs` resource, so `sharp`'s native addon can `dlopen` libvips (pkg's
VFS cannot satisfy its RPATH).

See `src-tauri/src/dsh.rs` for the supervisor and URL parser (with unit
tests), and `src-tauri/src/lib.rs` for the wiring.

## Prerequisites

- **macOS 13+** (the bundle is macOS-only today; the same Rust also compiles
  on Linux/Windows once those deps are present).
- **Rust** 1.77.2+ (`rustup`).
- **Tauri CLI** — either `pnpm` (the `@tauri-apps/cli` devDependency) or
  `cargo install tauri-cli`.

## Run (development)

```sh
# from this directory (apps/tauri)
pnpm install            # in the repo root, once
pnpm tauri dev          # or: cargo tauri dev
```

The window opens on the served GUI. `dsh`'s stderr is inherited, so host
diagnostics appear in your terminal. In dev the sidecar is not bundled, so
`DSH_BIN` (or `dsh` on `PATH`) is used.

## Build the macOS app

```sh
node --import tsx/esm scripts/build-tauri-sidecar.ts --targets node24-macos-arm64
pnpm tauri build        # from apps/tauri
```

The first step builds the `dsh-web` sidecar, its node-pty `dsh-web-spawn-helper`,
and its sharp libvips libraries into `apps/tauri/binaries/`; `tauri build` then
bundles all three. Produces
`src-tauri/target/release/bundle/macos/DeepSeek Harness.app` and a `.dmg`. Note:
building the `.app`/`.dmg` requires macOS (bundling, code signing, and
`icon.icns` are macOS-only steps); `cargo check`/`cargo build` of the Rust
itself works on Linux with the WebKitGTK 4.1 dev packages installed.

The app version comes from the repository root `package.json`. Pushing a matching `dsh-v<version>` tag runs the macOS workflow and creates a GitHub Release containing the built DMG; prerelease versions such as `dsh-v0.1.1-rc.2` create GitHub prereleases. Branch, pull-request, and untagged manual runs retain only the seven-day Actions artifact. A manual run selected from a matching tag also publishes the release.

## Verify from source

The supervisor tests need only `rustc`; the smoke command launches the real
source CLI with an isolated home, local model service, and test-only Bash path.

```sh
rustc --edition=2021 --test apps/tauri/src-tauri/tests/supervisor.rs -o /tmp/dsh-supervisor-test
/tmp/dsh-supervisor-test
node --import tsx/esm scripts/smoke-tauri-bundle.ts --source-cli
```

## Configuration

- `DSH_BIN` — binary to spawn when no `dsh-web` exists beside the application
  executable (default fallback: `dsh` on `PATH`).
- `DSH_REMOTE_URL=http://host:port` — remote mode: load an already-running
  `dsh --profile web` host instead of spawning the local sidecar. The
  **Remote ▸ Connect to Remote…** menu item does the same interactively.
- Everything else (API key, `DSH_HOME`, `--host`, …) is dsh's own
  configuration and passes through the inherited environment. An
  `DEEPSEEK_API_KEY` is only needed to actually run an agent; the GUI opens
  without one.

## Known limitations and next steps

- **Native adjuncts.** The sidecar is accompanied by node-pty's executable
  `dsh-web-spawn-helper` and `sharp`'s libvips libraries. The macOS workflow
  checks their final `.app` locations, then exercises the signed sidecar's
  frontend, RPC, image, persistent-terminal, settings, and shutdown paths. It
  also launches the application and requests a normal macOS Quit.
- **Bounded hard-stop scope.** Graceful shutdown lets the CLI dispose detached
  subprocess groups and PTY sessions. If that path hangs, the supervisor's
  hard stop covers the sidecar's own process group; it cannot guarantee cleanup
  of an arbitrary process that detached into another group.
- **Loopback HTTP, no IPC bridge.** We use the same `http://127.0.0.1:<port>`
  transport a browser uses. If the shell later needs to load `dist/` over
  `file://`, the host's `FetchHandler`/`AbstractApiClient.doFetch` seams are
  the intended IPC-bridge insertion points (see
  `packages/host/apiproxy` and `packages/host/webserver`).
- **Placeholder icons.** Generated from `apps/web/public/favicon.svg`; replace
  with a proper branded icon set before shipping.
- **Ad-hoc signature.** The explicit `-` signing identity prevents Apple Silicon
  downloads from being reported as damaged. This keyless build disables the
  hardened runtime because the embedded Node/V8 sidecar needs executable memory;
  the release workflow verifies the bundle signature and exercises the signed
  sidecar and application before publication. Because
  the app is not notarized, first launch can still require approval in **System
  Settings ▸ Privacy & Security**. Warning-free distribution needs a Developer ID
  Application certificate and Apple notarization credentials in CI.
