# Agent Note: Trusted remote settings use Host persistence

Status: implemented

English | [中文](2026-09-15-trusted-remote-settings.zh.md)

## Problem

The connection server accepts settings and credential RPCs from declared trusted authorities, but the browser settings layer selected process-local memory mode whenever `connection.isLoopback` was false. A trusted remote browser therefore skipped `settings.describe` entirely: Models could not load its provider directory, preferences were inert, and the welcome acknowledgement disappeared on reload even though the Host would have accepted every required settings operation.

## Decision

Production `SettingsDescribeMirror` and `SettingsScopeController` instances always use Host persistence. Network authorization belongs solely to the connection server's trusted-authority policy; the browser does not duplicate that policy by interpreting its URL as an authorization decision. The explicit memory mode remains available to isolated consumers and tests, but production assembly never selects it from `isLoopback`.

The native `settings.openDocument` operation remains loopback-only. Granting a trusted authority access to the settings document's redacted values and mutation API does not grant control of the Host desktop.

## Alternatives considered

**Keep non-loopback settings in memory.** Rejected because it contradicts the server grant and makes trusted remote use unable to configure models or retain preferences.

**Try the Host and fall back silently to memory after refusal.** Rejected because two persistence locations would make a temporary transport or authorization failure look like a successful but non-durable write. A refused authority must remain visibly refused.

**Return settings RPCs to loopback-only.** Rejected because the all-interface deployment explicitly treats its declared network authority as the authorization boundary for session execution, settings, and credentials.

## Consequences

A trusted remote browser reads and writes the same settings document as a loopback browser. The remote-browser e2e dismisses the welcome notice, reloads to prove the acknowledgement persisted, and opens Models through the real provider-directory join. Connection tests continue to prove that an undeclared authority receives 403 and that `settings.openDocument` remains loopback-only.
