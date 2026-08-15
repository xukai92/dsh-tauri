# dsh-tauri

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
   closure) and embedded via Tauri `externalBin` — with `--profile web --port 0`
   (`--port 0` lets the OS pick a free port so two shells never collide).
   `DSH_BIN` overrides the binary for development.
2. A worker thread reads the host's stdout until it finds the readiness line
   `dsh web: http://127.0.0.1:<port>`, then parses the port.
3. A `WebviewWindowBuilder` opens window `main` on that external URL.
4. The child process is held in Tauri managed state and killed on drop, so
   quitting the shell tears the host down with it.

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

The first step builds the `dsh-web` sidecar and emits its sharp libvips
libraries into `apps/tauri/binaries/`; `tauri build` then bundles both. Produces
`src-tauri/target/release/bundle/macos/DeepSeek Harness.app` and a `.dmg`. Note:
building the `.app`/`.dmg` requires macOS (bundling, code signing, and
`icon.icns` are macOS-only steps); `cargo check`/`cargo build` of the Rust
itself works on Linux with the WebKitGTK 4.1 dev packages installed.

## Configuration

- `DSH_BIN` — override the binary to spawn (default: the bundled `dsh-web`
  sidecar, then `dsh` on `PATH`).
- Everything else (API key, `DSH_HOME`, `--host`, …) is dsh's own
  configuration and passes through the inherited environment. An
  `DEEPSEEK_API_KEY` is only needed to actually run an agent; the GUI opens
  without one.

## Known limitations and next steps

- **Single-file exe, plus one shared library.** The sidecar itself is one
  file, but `sharp` (image attachments) needs its libvips libraries shipped
  beside it (`apps/tauri/binaries/sharp-libs`), because pkg's VFS cannot
  satisfy the `.node` RPATH. Node-pty's macOS `spawn-helper` needs the same
  treatment for persistent terminals.
- **Loopback HTTP, no IPC bridge.** We use the same `http://127.0.0.1:<port>`
  transport a browser uses. If the shell later needs to load `dist/` over
  `file://`, the host's `FetchHandler`/`AbstractApiClient.doFetch` seams are
  the intended IPC-bridge insertion points (see
  `packages/host/apiproxy` and `packages/host/webserver`).
- **Placeholder icons.** Generated from `apps/web/public/favicon.svg`; replace
  with a proper branded icon set before shipping.
- **Unsigned build.** `tauri build` output is ad-hoc signed; distribution needs
  a Developer ID and notarization.
