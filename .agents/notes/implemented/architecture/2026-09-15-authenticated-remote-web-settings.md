# Agent Note: Authenticated remote Web settings

Status: implemented

English | [中文](2026-09-15-authenticated-remote-web-settings.zh.md)

## Problem

The Web application already authenticated every Host API request and fenced each serving authority, but the shipped CLI rejected its existing all-interfaces bind mode. A separately composed remote Host could serve the application, yet the Client disabled the settings API solely because the page authority was not loopback. Authenticated remote users therefore could run tool-capable Sessions but could not retain ordinary preferences or acknowledge the welcome notice across a reload.

## Decision

`dsh web --host 0.0.0.0` enables the webserver's existing all-interfaces bind. The Web runtime samples non-internal IPv4 addresses as trusted, port-less LAN authorities and accepts additional named authorities only through repeatable `--trusted-host`. Every API request still passes the Host/Origin/Fetch-Metadata fence and then the process-token cookie authentication owned by the existing security decisions. The server remains plain HTTP and interprets no forwarding headers.

The Web Client uses Host settings persistence for every authenticated serving authority. This changes preference and onboarding persistence only; `ctx.connection.isLoopback` continues to guard desktop-native actions whose operator must sit at the Host. A trusted authority never changes that fact and does not make a remote page local.

## Verification

The command-line provider test accepts the explicit all-interfaces value while retaining invalid-port rejection. The remote browser scenario maps only `remote.test` inside Chromium, performs the process-token exchange against the real loopback socket with `Host: remote.test:<port>`, and runs the assembled Web application over that authority. It asserts an insecure browser context without `crypto.randomUUID`, calls the real authenticated settings RPC, observes the welcome acknowledgement in the isolated Host document, reloads to a settled Settings shell, and observes that the notice stays dismissed. Existing Connection suites retain forged-Host, cross-origin, unauthenticated, authority-bound-cookie, and cookie-restart coverage.

## Alternatives considered

**Treat a trusted authority as loopback.** Rejected because it would also enable desktop-native actions and any future local-only behavior. Serving-authority trust and physical proximity to the Host remain separate facts.

**Keep remote settings in browser memory.** Rejected because authentication already authorizes the complete tool-capable Host API. Disabling only preference persistence adds no security boundary and produces inconsistent behavior across reloads.

**Add TLS or reverse-proxy forwarding-header support.** Rejected because the shipped server has no certificate or proxy configuration owner. Deployments that expose it beyond a trusted network must provide transport protection without making forwarded headers authoritative inside Harness.

## Consequences

An operator can deliberately serve the Web application on a LAN or named authority without a custom composition, and authenticated clients share the Host's durable settings document. Plain HTTP exposes the launch URL and session cookie to the network, so this mode is appropriate only where the operator accepts that transport risk or supplies protection outside Harness. The browser trust and token authentication notes remain active because their independent security rules still govern every request; no existing Agent Note is superseded completely or archived.
