# Agent Note: Publish the macOS app from dsh release tags

Status: implemented

English | [中文](2026-09-14-tauri-github-release.zh.md)

## Problem

The macOS workflow retained its `.app` and DMG only as a seven-day GitHub Actions artifact. A successful build therefore produced no durable, versioned download, and creating a GitHub Release separately could attach bytes from a different build or commit. The Tauri configuration also carried an independent literal version, so its bundle metadata and filename could diverge from the dsh release tag.

## Decision

`.github/workflows/build-tauri-macos.yml` builds ordinary branch, pull-request, and manual runs with read-only repository permissions. It also accepts `dsh-v*` tag pushes. A tag run verifies that the tag equals `dsh-v` plus the repository root `package.json` version before installing dependencies or building.

The build job uploads the macOS bundle under the existing `dsh-tauri-macos-aarch64` artifact name. A dependent release job runs only for a `refs/tags/dsh-v*` ref, downloads that exact artifact, requires exactly one DMG, and passes it to `gh release create` with `--verify-tag` and generated release notes. The job sets `GH_REPO` from `github.repository` because it does not check out the source tree. Only this job receives `contents: write`; builds from mutable branches and pull requests retain `contents: read`.

The bundle config supplies Tauri's `-` signing identity explicitly. This produces the ad-hoc signature required for downloaded Apple Silicon applications when no Apple Developer credentials are available. Tauri's hardened runtime is disabled for this keyless build because applying it to the embedded Node executable prevents V8 from reserving its executable code range. Before uploading, the workflow verifies the complete app bundle with `codesign --deep --strict`, then exercises the signed sidecar and a normal application Quit as described in the [bundle runtime smoke note](../testing/2026-09-15-tauri-bundle-runtime-smoke.md). A structurally valid signature that prevents the application or its native runtime paths from working therefore cannot reach a release.

A version with a prerelease segment creates a GitHub prerelease and is not marked latest. A stable version leaves GitHub's normal latest-release selection in effect. Tauri reads the repository root `package.json` through the configuration's supported package path, so the shared dsh version bump also supplies the macOS bundle version.

The workflow test pins the tag trigger, ref condition, split permissions, tag verification, DMG selection, release command, prerelease handling, and Tauri version source.

## Alternatives considered

**Publish every successful main-branch build under a rolling release.** This makes the newest build easy to download but gives mutable commits one stable release identity, cannot derive durable release notes, and conflicts with the repository's tag-based public publication process.

**Grant `contents: write` to the build job and create the release there.** This avoids transferring the Actions artifact between jobs, but every branch and pull-request build receives a write-capable token even though only a tag can publish. The dependent job keeps publication authority out of validation runs and proves the uploaded release asset is the retained build output.

**Create a separate release workflow that rebuilds the app.** This isolates publication triggers, but the GitHub Release would not consume the successful build's artifact. Calling or duplicating the expensive macOS build also creates two workflow definitions that can drift.

**Upload the `.app` directory directly.** GitHub Release assets are files. The DMG is the macOS distribution file already produced by Tauri, while the `.app` remains available inside the short-lived Actions artifact for build inspection.

## Consequences

Pushing or manually dispatching a matching `dsh-v*` tag produces a durable GitHub Release whose DMG comes from the completed macOS build. A branch, pull request, mismatched tag, or manual branch dispatch cannot create a release. Re-running a tag after its release exists fails rather than replacing a published asset.

The published app remains ad-hoc signed and unnotarized. The signature prevents macOS from reporting an unsigned Apple Silicon download as damaged, but users can still need to approve first launch in Privacy & Security. Warning-free distribution requires a Developer ID Application certificate and Apple notarization credentials.
