# Agent Note: Keep downstream CI on public hosted runners

Status: implemented

English | [中文](2026-09-16-downstream-hosted-ci.zh.md)

## Problem

The upstream workflows select organization-only runner labels, persistent self-hosted machines, Blacksmith capacity, and live API credentials. A public downstream repository does not own those resources, but replacing the workflows would discard useful validation and make upstream integration harder.

## Decision

Runner and setup expressions use `github.repository_owner` as the fork boundary. The `deepseek-ai` repository retains its custom, self-hosted, and Blacksmith paths; other owners use standard public GitHub-hosted labels even when copied repository variables still name an upstream failover mode. Cache restoration, Playwright installation, temporary paths, and worker budgets follow the selected runner rather than the variable alone. Downstream Linux and Windows jobs use bounded concurrency suitable for standard hosted machines.

Useful post-merge Python runtime, Wine, sandbox, and native-addon checks accept both `main` and `master`. Self-hosted standby drills and hardware comparison matrices remain upstream-only because standard hosted lanes already cover their software behavior and cannot reproduce their infrastructure measurements.

The reusable Python runtime builder always runs installed-wheel keyless checks. Its live API preflight and smoke require an explicit `real_api` input; automatic upstream callers opt in, while downstream callers remain keyless unless a maintainer selects the manual input. Selecting live mode without the secret fails preflight. The dedicated real-API E2E workflow follows the same policy: automatic trusted events upstream and explicit manual dispatch downstream.

## Alternatives considered

**Delete upstream-only lanes.** Owner predicates preserve the upstream topology and reduce recurring merge conflicts while preventing downstream jobs from requesting unavailable runners.

**Map infrastructure benchmarks to standard runners.** Those jobs measure named hardware tiers or persistent-runner behavior. Running them on unrelated hosted capacity would produce misleading comparisons and duplicate required validation.

**Let missing secrets skip live API tests.** A selected live test must fail when credentials are missing; keyless checks remain the default downstream evidence.

## Consequences

- Downstream pull-request and post-merge validation can start without organization runner labels or copied failover variables changing its setup path.
- Standard hosted machines use smaller coverage partitions, worker counts, and snapshot concurrency, so the full matrix costs more wall time than upstream high-capacity lanes.
- Live provider checks are not automatic downstream; a maintainer must dispatch them with a configured secret.
- The [CI failover runbook](2026-07-26-ci-failover-runbook.md), [serial cross-platform reference](2026-07-21-serial-cross-platform-ci-reference.md), [Blacksmith failover record](2026-09-09-blacksmith-failover-leg.md), and [real-API E2E record](../testing/2026-06-19-real-api-e2e-ci.md) remain authoritative for upstream operation.
