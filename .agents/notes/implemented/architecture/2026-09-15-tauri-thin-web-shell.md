# Agent Note: Keep the Tauri application a thin Web shell

Status: implemented

English | [中文](2026-09-15-tauri-thin-web-shell.zh.md)

## Problem

The Tauri distribution needs a native macOS window without creating another backend composition, RPC protocol, executable closure, or native-addon packaging route. Application exit must also allow the CLI to dispose persistent terminals and detached tool processes before Tauri terminates the process.

## Decision

`apps/tauri` is a thin window and process supervisor over the shipped `dsh web` application. It starts an adjacent `dsh-web` executable with an isolated port and browser opening disabled, preserves the complete authenticated readiness URL, and loads that URL in the system webview. Remote mode loads an explicit HTTP or HTTPS URL without starting a local Host. No Tauri IPC endpoint duplicates the Web Fetch, RPC, or stream protocols.

`scripts/build-tauri-sidecar.ts` delegates executable construction to `scripts/build-exe-for-python-sdk.ts`. The adapter copies the maintained runtime executable, macOS node-pty spawn helper, and ripgrep companion into Tauri's target-suffixed `externalBin` names. The Tauri path therefore shares the Python runtime closure, bootstrap, native-asset handling, root-pinned patched `@yao-pkg/pkg`, and packaged ripgrep selection. It owns no dependency-only closure or sharp resource layout.

The Rust supervisor creates one process group, forwards `SIGTERM`, waits six seconds for the CLI's bounded disposal, then kills that group if it remains. Graceful CLI disposal owns detached subprocess groups and PTY sessions; escalation guarantees only the supervisor-owned group. `RunEvent::Exit` explicitly removes managed Host state because Tauri terminates after the run callback without guaranteeing Rust managed-state destruction.

The desktop release version is the literal Tauri configuration version and matches Cargo. The private npm manifest remains required workspace tooling metadata and may follow repository-wide private-workspace bumps. Only `tauri-v<version>` identifies this application's release workflow.

The existing Electron Desktop decisions remain authoritative for the upstream portless, plugin-managing, notarized distribution. This fork-specific Tauri carrier is a smaller alternative and does not supersede those notes.

## Verification

Linux runs the supervisor tests directly with `rustc`, including graceful group shutdown, leader exit, and bounded escalation. The source driver launches the real CLI against isolated Harness, Agent, credential, and workspace state plus a keyless local Messages provider. It requires authenticated HTTP/RPC, persisted settings, a completed image round with normalized WebP metadata, persistent PTY output, a live background descendant before shutdown, and a real ripgrep-backed match.

The macOS workflow repeats those observations through the signed `.app` resources, inventories the executable plus both native companions, and verifies code signing. It also launches the actual application, observes its unauthorized loopback listener, requests a normal application Quit, and requires both application and Host child to exit.

## Alternatives considered

**Maintain a Tauri-specific executable closure.** A second dependency manifest, bootstrap, pkg invocation, sharp library extraction, and native path resolver duplicate the maintained Python runtime path and drift when the runtime changes. The adapter reuses its products instead.

**Treat Rust `Drop` as application-exit ownership.** Tauri's run lifecycle may terminate the process without dropping managed state. Explicit exit-event teardown gives the CLI its disposal window while application code still runs.

**Kill only the Host leader.** Persistent terminals and tool processes can survive their leader. Graceful CLI disposal precedes process-group escalation, and tests distinguish the owned process group from arbitrary detached descendants.

## Consequences

The Tauri application stays small in source and follows one packaged runtime implementation. Its loopback transport retains the Web application's authentication and security behavior, at the cost of opening a local listener rather than using Electron Desktop's portless carrier. Native release qualification remains macOS-only and requires the signed-bundle smoke; Linux establishes only source/runtime protocol behavior and supervisor ownership.
