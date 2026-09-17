# Agent Note: OpenCode per-conversation session header

Status: implemented

English | [中文](2026-09-17-opencode-session-header.zh.md)

## Problem

The OpenCode Go and Zen gateways reject an inference request that lacks a stable per-conversation `x-opencode-session` header with HTTP 400 `MissingSessionID`. The harness reaches both gateways through `dsh-llm-pi-ai`, which passes `GenerateOptions.sessionId` into pi-ai but sends no provider header for it: pi-ai 0.85.1 does not map the option to that header. `dsh-llm-deepseek` already sends a session header for the DeepSeek provider; OpenCode routes have no equivalent. The gateway uses the id for backend routing and prompt-cache affinity, so one fixed header shared by every conversation cannot substitute.

## Decision

`dsh-llm-pi-ai` stamps `x-opencode-session` on every request whose route is an OpenCode gateway (`opencode` or `opencode-go`) and whose `GenerateOptions.sessionId` is present. The value is the harness session id: unique per conversation and stable across turns, resume, compaction, retries, and auxiliary calls, because the agent loop, session-title, and compaction paths all pass the same durable `Session.id`. The header is model-hidden transport metadata — absent from the JSON request body, prompt, token accounting, KV-cache identity, and session log. A profile `headers` entry of the same name is overridden, because a fixed value would put every conversation in one routing and cache bucket. Routes outside the OpenCode family are untouched, and no header is sent when the request carries no session id.

pi-ai owns this mapping upstream ([earendil-works/pi#9326](https://github.com/earendil-works/pi/issues/9326)); the adapter-local injection is deleted when an upgraded pi-ai sends the header itself.

## Verification

- `packages/llm/llm-pi-ai/tests/adapter.spec.ts` asserts the header value on an `opencode-go` route, the same on an `opencode` route, that the session id overrides a static same-named profile header, that a request without a session id sends none, and that a non-OpenCode route receives no header.
- No keyless snapshot changes: the header is model-hidden and never reaches transcript content.

## Alternatives considered

**A static `headers` entry.** Configuration can set `x-opencode-session` to a fixed string, but one value for every conversation degrades the gateway's routing and prompt-cache affinity; the upstream discussion measured the cost.

**An opt-in `sessionHeader` profile field.** Naming a header per route generalizes to any gateway, but it needs every deployment to opt in for a closed, catalog-known provider family, and it exposes a provider detail through generic configuration. Automatic injection on the OpenCode routes covers the catalog routes without configuration.

**Stamping every outbound request.** Sending the header to unrelated providers leaks a conversation identifier to recipients with no routing need for it.

## Consequences

- OpenCode Go and Zen routes serve without per-route configuration and keep per-conversation routing and prompt-cache affinity.
- A profile that sets a static `x-opencode-session` header loses it on real requests; the runtime value winning is intentional.
- The adapter carries a provider special case that pi-ai will own upstream, so the removal is a small, isolated change once the pi-ai release ships it.
