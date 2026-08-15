# FORK.md

Fork of `deepseek-harness` that re-enables binding the Web UI to all interfaces
(`dsh web --host 0.0.0.0`) so it can be visited over Tailscale and other
non-loopback networks.

Upstream deliberately rejects `--host 0.0.0.0` (PR #2484) because the Web UI is
an unauthenticated remote-code-execution surface. This fork re-enables it on the
premise that the tailnet — or, more precisely, the network reachable at the
declared `--trusted-host` authority — IS the authentication boundary.

All fork documentation lives in this file; the upstream README files and Agent
Notes are left unmodified.

## Usage

```sh
dsh web --host 0.0.0.0 --trusted-host dev-box.tailXXXX.ts.net
```

Visit `http://dev-box.tailXXXX.ts.net:3080`. The device's Tailscale IP is also
accepted automatically, because all non-internal IPv4 interface literals are
derived as trusted authorities when binding all interfaces.

## Security model

`--host 0.0.0.0 --trusted-host <x>` declares that anyone who can reach `<x>`
— for Tailscale, every device on the tailnet — may:

- read and write settings and credentials (API keys included), and
- create sessions that run tools as this process (RCE, which was never pinned).

There is no authentication layer. The `/api` trust fence is a DNS-rebinding
defense, not authentication. Desktop-native operations (native directory/editor
dialogs) and host-side probes stay loopback-only, listed under "Still
loopback-only" below.

## Patches

### 1. Re-enable `--host 0.0.0.0`

`packages/bundle/web-app/src/startup.ts` no longer rejects `--host 0.0.0.0` as
a usage error; the flag binds all interfaces as an explicit opt-in. Its help
text and the startup/built-bin tests updated to match.

### 2. Secure-context-free randomness

The Web client used `crypto.randomUUID()`, a secure-context-only API that
browsers omit on plain-HTTP non-loopback origins, which broke every RPC
(`crypto.randomUUID is not a function`). Replaced with a
`crypto.getRandomValues`-backed UUID v4 in every browser-reachable call site:

- `packages/host/apiproxy/src/fetch/client.ts` — `mintRpcId`
- `packages/llm/llm/src/message.ts` — `createMessage`
- `packages/client/ui-conversation/src/client/service.ts` — draft-attachment id

### 3. Configuration plane follows `--trusted-host`

`packages/client/connection/src/index.ts` split the old loopback-only method
set. Settings and credentials now pass the `--trusted-host` fence:

- `settings.describe`, `settings.update`, `settings.replace`, `settings.mutate`
- `credentials.describe`, `credentials.set`, `credentials.unset`

### 4. Settings persistence tries Host and degrades gracefully

`packages/client/ui-settings/src/client/settings-scope.ts` and
`packages/client/ui-settings-models/src/client/index.ts` no longer select
process-local `memory` mode from `isLoopback`. The scope always reads Host
settings; a refused read publishes `unavailable` on the first attempt and
otherwise keeps the last good value. This removes the raw
`transport failure ... HTTP 403` dumps and the stuck "Loading..." states over
a remote browser.

## Still loopback-only

These stay pinned to loopback even for a declared trusted authority, because
they drive the host machine's own desktop or issue a host-side probe:

- `host.pickDirectory`, `host.openPath`
- `settings.openDocument`
- `agentPreset.read`, `agentPreset.copy`, `agentPreset.openDocument`, `agentPreset.remove`
- `llm.discoverModels`

## Known limitations

- The schema-form settings sections render from `settingsScope`; the `memory`
  persistence mode still exists as an unused constructor option and is not yet
  removed (removing it would change the `SettingsScopeSnapshot.mode` contract
  in `dsh-client-runtime`).
- `navigator.clipboard` in `packages/client/ui-primitives/src/JsonTree.tsx`
  fails over a non-secure context; it is caught and shows "copy failed".
- Four self-contained copies of the UUID-v4 helper exist
  (`connection`, `apiproxy`, `dsh-llm`, `ui-conversation`), kept apart by the
  client bundle-purity gate rather than a shared util package.
