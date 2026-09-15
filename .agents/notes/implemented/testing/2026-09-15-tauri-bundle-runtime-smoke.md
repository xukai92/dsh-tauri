# Agent Note: Exercise the macOS bundle runtime before publication

Status: implemented

English | [中文](2026-09-15-tauri-bundle-runtime-smoke.zh.md)

## Problem

The macOS workflow proved only that the signed sidecar reached its startup line. That check accepted an application bundle without node-pty's spawn helper, did not load the frontend or call RPC, and never exercised image processing, a persistent terminal, settings persistence, application Quit, or descendant cleanup. Source tests could not establish that native executables and libraries occupied the locations expected inside the signed `.app`.

The desktop supervisor also relied on managed-state destruction even though Tauri exits the process without guaranteeing that managed Rust values are dropped. Killing only the host leader could leave same-group descendants alive, while killing the host group before its CLI shutdown completed could interrupt cleanup of detached subprocess groups and PTY sessions.

## Decision

The macOS workflow first verifies the complete application signature, then runs `scripts/smoke-tauri-bundle.ts` against the built `.app`. The smoke requires `dsh-web`, `dsh-web-spawn-helper`, and populated `sharp-libs` resources at their shipped locations. It starts the signed sidecar with an isolated `DSH_HOME`, a scrubbed environment, and a keyless local model service; loads the actual frontend; calls RPC; persists a setting; sends an image through sharp normalization; completes a model turn through a persistent PTY; and confirms that graceful sidecar shutdown removes the live PTY subprocess. The same driver has a source mode with a test-only preset that selects an executable Bash path, so its protocol and escaping logic can run on Linux without changing the product's macOS defaults.

The smoke then launches `Contents/MacOS/dsh-tauri`, discovers its direct `dsh-web` child and listening port, loads that frontend, requests the standard macOS application Quit through AppleScript, and requires both processes to exit. This executes the Tauri `RunEvent::Exit` path rather than assuming a sidecar-only test covers application shutdown.

The supervisor starts its local host in a distinct process group. Normal application exit explicitly takes the managed host and sends that group `SIGTERM`, allowing six seconds for the CLI's five-second context disposal before sending `SIGKILL` to a remaining group. Cross-platform standalone Rust tests cover complete readiness URL preservation, strict loopback readiness parsing, ordinary group cleanup, and escalation when the leader exits while a same-group descendant ignores `SIGTERM`. Graceful CLI disposal remains responsible for subprocesses and PTYs that created their own groups.

The remote browser test uses `remote.test` through Chromium host resolution. It asserts an insecure context without `crypto.randomUUID`, calls the real host RPC surface, acknowledges the welcome setting, reloads, and observes the persisted remote setting. Its environment is keyless and isolated from ambient credentials.

## Alternatives considered

**Inspect source strings or build output only.** The missing spawn helper was emitted before bundling, so neither the build log nor a source assertion represented the final application inventory. Inventory checks remain useful, but runtime behavior is the acceptance signal.

**Add a product smoke command for native libraries.** A test-only product entry point would add a shipped interface solely for validation. The assembled frontend, RPC, model replay, image, and PTY paths already expose the required behavior.

**Exercise only the signed sidecar.** This would not execute Tauri's exit callback and would miss a regression that leaves the desktop-managed host running after normal Quit.

**Use a localhost subdomain for remote HTTP.** Browsers treat localhost names as potentially trustworthy, so that origin cannot reproduce missing secure-context crypto APIs on ordinary insecure remote HTTP.

**Immediately kill the host process group.** This removes same-group descendants but can interrupt the CLI before it disposes detached tool groups and PTY sessions. Bounded graceful shutdown preserves the cleanup owner while retaining an escalation deadline.

## Consequences

A macOS artifact cannot pass the workflow with a missing native helper or with startup-only success masking broken HTTP, RPC, image, terminal, persistence, or normal-Quit behavior. Linux can run the supervisor regressions and source smoke without installing the complete Tauri/WebKit development stack.

The actual bundle and application launch remain macOS CI evidence; Linux can inspect an artifact's inventory but cannot execute its Mach-O files. The hard-stop fallback guarantees cleanup only for the sidecar process group. If graceful CLI disposal hangs after a tool has detached into another group, the supervisor cannot guarantee that arbitrary detached process is removed.
