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

1. `run()` spawns `dsh --profile web --port 0` (`DSH_BIN` overrides the binary;
   `--port 0` lets the OS pick a free port so two shells never collide).
2. A worker thread reads the host's stdout until it finds the readiness line
   `dsh web: http://127.0.0.1:<port>`, then parses the port.
3. A `WebviewWindowBuilder` opens window `main` on that external URL.
4. The child process is held in Tauri managed state and killed on drop, so
   quitting the shell tears the host down with it.

See `src-tauri/src/dsh.rs` for the supervisor and URL parser (with unit
tests), and `src-tauri/src/lib.rs` for the wiring.

## Prerequisites

- **macOS 13+** (the bundle is macOS-only today; the same Rust also compiles
  on Linux/Windows once those deps are present).
- **Rust** 1.77.2+ (`rustup`).
- **Tauri CLI** — either `pnpm` (the `@tauri-apps/cli` devDependency) or
  `cargo install tauri-cli`.
- **`dsh` on `PATH`** — an installed build whose web frontend dist is present
  (e.g. `pnpm build` in this repo, or a published `dsh`). Or set `DSH_BIN` to
  an explicit path.

## Run (development)

```sh
# from this directory (apps/tauri)
pnpm install            # in the repo root, once
pnpm tauri dev          # or: cargo tauri dev
```

The window opens on the served GUI. `dsh`'s stderr is inherited, so host
diagnostics appear in your terminal.

## Build the macOS app

```sh
pnpm tauri build        # or: cargo tauri build
```

Produces `src-tauri/target/release/bundle/macos/DeepSeek Harness.app` and a
`.dmg`. Note: building the `.app`/`.dmg` requires macOS (bundling, code signing,
and `icon.icns` are macOS-only steps); `cargo check`/`cargo build` of the Rust
itself works on Linux with the WebKitGTK 4.1 dev packages installed.

## Configuration

- `DSH_BIN` — path to the `dsh` binary to spawn (default: `dsh` on `PATH`).
- Everything else (API key, `DSH_HOME`, `--host`, …) is dsh's own
  configuration and passes through the inherited environment. An
  `DEEPSEEK_API_KEY` is only needed to actually run an agent; the GUI opens
  without one.

## Known limitations and next steps

- **No sidecar bundling yet.** `dsh` must already be installed on the target
  machine; the app does not embed it. Next step is bundling the single-exe
  `dsh` as a Tauri `externalBin` sidecar for a self-contained `.app`.
- **Loopback HTTP, no IPC bridge.** We use the same `http://127.0.0.1:<port>`
  transport a browser uses. If the shell later needs to load `dist/` over
  `file://`, the host's `FetchHandler`/`AbstractApiClient.doFetch` seams are
  the intended IPC-bridge insertion points (see
  `packages/host/apiproxy` and `packages/host/webserver`).
- **Placeholder icons.** Generated from `apps/web/public/favicon.svg`; replace
  with a proper branded icon set before shipping.
- **Unsigned build.** `tauri build` output is ad-hoc signed; distribution needs
  a Developer ID and notarization.
